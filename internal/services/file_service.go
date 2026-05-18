package services

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
)

type FileService struct {
	db        *gorm.DB
	s3Client  *storage.S3Client
	cacheRoot string
}

func NewFileService(db *gorm.DB, s3 *storage.S3Client) *FileService {
	return &FileService{db: db, s3Client: s3}
}

func (s *FileService) SetCacheRoot(cacheRoot string) {
	s.cacheRoot = cacheRoot
}

func (s *FileService) ListDepots(ctx context.Context, bucketID uint, esxiVersion ...string) ([]models.FileMetadata, error) {
	query := s.db.WithContext(ctx).
		Where("storage_bucket_id = ? AND type = ?", bucketID, models.FileTypeDepot)

	if len(esxiVersion) > 0 && strings.TrimSpace(esxiVersion[0]) != "" {
		query = query.Where("esxi_version IN ?", esxiVersionAliases(esxiVersion[0]))
	}

	var files []models.FileMetadata
	err := query.
		Order("path ASC").
		Find(&files).Error
	if err == nil {
		err = s.applyCacheStatus(ctx, bucketID, files)
	}
	return files, err
}

func (s *FileService) ListDrivers(ctx context.Context, bucketID uint, esxiVersion, category string) ([]models.FileMetadata, error) {
	query := s.db.WithContext(ctx).
		Where("storage_bucket_id = ? AND type = ?", bucketID, models.FileTypeDriver)

	if esxiVersion != "" {
		query = query.Where("esxi_version IN ?", esxiVersionAliases(esxiVersion))
	}
	if category != "" {
		query = query.Where("driver_category = ?", category)
	}

	var files []models.FileMetadata
	err := query.Order("path ASC").Find(&files).Error
	if err == nil {
		err = s.applyCacheStatus(ctx, bucketID, files)
	}
	return files, err
}

func (s *FileService) ListISOs(ctx context.Context, bucketID uint) ([]models.FileMetadata, error) {
	var files []models.FileMetadata
	err := s.db.WithContext(ctx).
		Where("storage_bucket_id = ? AND type = ?", bucketID, models.FileTypeISO).
		Order("path ASC").
		Find(&files).Error
	return files, err
}

func (s *FileService) UploadFile(ctx context.Context, bucketID uint, fileType, esxiVersion, driverCategory string, filename string, reader io.Reader, size int64) (*models.FileMetadata, error) {
	bucket, err := s.getBucket(ctx, bucketID)
	if err != nil {
		return nil, err
	}

	objectPath, err := buildObjectPath(fileType, esxiVersion, driverCategory, filename)
	if err != nil {
		return nil, err
	}

	shaHasher := sha256.New()
	md5Hasher := md5.New()
	hashingReader := io.TeeReader(reader, io.MultiWriter(shaHasher, md5Hasher))
	var objectInfo minio.ObjectInfo
	var infoErr error
	switch models.NormalizeStorageType(bucket.Type) {
	case models.StorageTypeLocal:
		store, err := storage.NewLocalStore(bucket.LocalPath)
		if err != nil {
			return nil, err
		}
		if err := store.Upload(ctx, objectPath, hashingReader, size, detectContentType(filename)); err != nil {
			return nil, err
		}
		objectInfo, infoErr = store.GetObjectInfo(ctx, objectPath)
	case models.StorageTypeS3:
		client, err := s.newS3ClientForBucket(bucket)
		if err != nil {
			return nil, err
		}
		if err := client.Upload(ctx, objectPath, hashingReader, size, detectContentType(filename)); err != nil {
			return nil, err
		}
		objectInfo, infoErr = client.GetObjectInfo(ctx, objectPath)
	default:
		return nil, fmt.Errorf("unsupported storage type: %s", bucket.Type)
	}

	metadata := &models.FileMetadata{
		StorageBucketID:   bucket.ID,
		Path:              objectPath,
		Type:              normalizeFileType(fileType),
		ESXiVersion:       esxiVersion,
		DriverCategory:    driverCategory,
		DriverType:        strings.TrimPrefix(strings.ToLower(filepath.Ext(filename)), "."),
		DriverName:        displayNameFromFilename(filename),
		DriverVersion:     versionTagFromFilename(filename),
		DriverDescription: fileDescription(objectPath, normalizeFileType(fileType)),
		MD5:               hex.EncodeToString(md5Hasher.Sum(nil)),
		SHA256:            hex.EncodeToString(shaHasher.Sum(nil)),
		Size:              size,
	}

	if infoErr == nil {
		indexed := objectInfoToMetadata(bucket.ID, objectInfo)
		metadata.Path = indexed.Path
		metadata.Type = indexed.Type
		metadata.ESXiVersion = indexed.ESXiVersion
		metadata.DriverCategory = indexed.DriverCategory
		metadata.DriverType = indexed.DriverType
		metadata.DriverName = indexed.DriverName
		metadata.DriverDescription = indexed.DriverDescription
		metadata.DriverVersion = indexed.DriverVersion
		metadata.ETag = objectInfo.ETag
		metadata.Size = objectInfo.Size
		lastModified := objectInfo.LastModified
		metadata.LastModified = &lastModified
	}

	if err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "storage_bucket_id"}, {Name: "path"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"deleted_at",
			"type",
			"esxi_version",
			"driver_category",
			"driver_type",
			"driver_name",
			"driver_description",
			"driver_version",
			"is_latest",
			"conflicts_with",
			"depends_on",
			"md5",
			"sha256",
			"size",
			"etag",
			"last_modified",
			"updated_at",
		}),
	}).Create(metadata).Error; err != nil {
		return nil, fmt.Errorf("upsert file metadata: %w", err)
	}

	if err := s.db.WithContext(ctx).
		Where("storage_bucket_id = ? AND path = ?", bucket.ID, objectPath).
		First(metadata).Error; err != nil {
		return nil, fmt.Errorf("find file metadata: %w", err)
	}

	return metadata, nil
}

func (s *FileService) DeleteFile(ctx context.Context, id uint) error {
	var file models.FileMetadata
	if err := s.db.WithContext(ctx).First(&file, id).Error; err != nil {
		return err
	}

	bucket, err := s.getBucket(ctx, file.StorageBucketID)
	if err != nil {
		return err
	}

	switch models.NormalizeStorageType(bucket.Type) {
	case models.StorageTypeLocal:
		store, err := storage.NewLocalStore(bucket.LocalPath)
		if err != nil {
			return err
		}
		if err := store.DeleteObject(ctx, file.Path); err != nil {
			return err
		}
	case models.StorageTypeS3:
		client, err := s.newS3ClientForBucket(bucket)
		if err != nil {
			return err
		}
		if err := client.DeleteObject(ctx, file.Path); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported storage type: %s", bucket.Type)
	}

	if err := s.db.WithContext(ctx).Delete(&file).Error; err != nil {
		return fmt.Errorf("delete file metadata: %w", err)
	}

	return nil
}

func (s *FileService) RenameFile(ctx context.Context, id uint, newName string) (*models.FileMetadata, error) {
	var file models.FileMetadata
	if err := s.db.WithContext(ctx).First(&file, id).Error; err != nil {
		return nil, err
	}

	cleanName, err := cleanRenameFilename(newName, file.Path)
	if err != nil {
		return nil, err
	}
	newPath := path.Join(path.Dir(file.Path), cleanName)
	if newPath == file.Path {
		return &file, nil
	}

	var existingCount int64
	if err := s.db.WithContext(ctx).
		Model(&models.FileMetadata{}).
		Where("storage_bucket_id = ? AND path = ? AND id <> ?", file.StorageBucketID, newPath, file.ID).
		Count(&existingCount).Error; err != nil {
		return nil, fmt.Errorf("check target metadata: %w", err)
	}
	if existingCount > 0 {
		return nil, fmt.Errorf("target path already exists: %s", newPath)
	}

	bucket, err := s.getBucket(ctx, file.StorageBucketID)
	if err != nil {
		return nil, err
	}

	var objectInfo minio.ObjectInfo
	switch models.NormalizeStorageType(bucket.Type) {
	case models.StorageTypeLocal:
		store, err := storage.NewLocalStore(bucket.LocalPath)
		if err != nil {
			return nil, err
		}
		if err := store.RenameObject(ctx, file.Path, newPath); err != nil {
			return nil, err
		}
		objectInfo, err = store.GetObjectInfo(ctx, newPath)
		if err != nil {
			return nil, err
		}
	case models.StorageTypeS3:
		client, err := s.newS3ClientForBucket(bucket)
		if err != nil {
			return nil, err
		}
		if err := client.RenameObject(ctx, file.Path, newPath); err != nil {
			return nil, err
		}
		objectInfo, err = client.GetObjectInfo(ctx, newPath)
		if err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unsupported storage type: %s", bucket.Type)
	}

	indexed := objectInfoToMetadata(file.StorageBucketID, objectInfo)
	updates := map[string]any{
		"path":               indexed.Path,
		"type":               indexed.Type,
		"esxi_version":       indexed.ESXiVersion,
		"driver_category":    indexed.DriverCategory,
		"driver_type":        indexed.DriverType,
		"driver_name":        indexed.DriverName,
		"driver_description": indexed.DriverDescription,
		"driver_version":     indexed.DriverVersion,
		"md5":                indexed.MD5,
		"size":               indexed.Size,
		"etag":               indexed.ETag,
		"last_modified":      indexed.LastModified,
	}
	if err := s.db.WithContext(ctx).Model(&file).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("update renamed metadata: %w", err)
	}
	if err := s.db.WithContext(ctx).First(&file, id).Error; err != nil {
		return nil, fmt.Errorf("find renamed metadata: %w", err)
	}
	return &file, nil
}

func (s *FileService) RefreshCache(ctx context.Context, bucketID uint) error {
	bucket, err := s.getBucket(ctx, bucketID)
	if err != nil {
		return err
	}

	if err := s.db.WithContext(ctx).
		Where("storage_bucket_id = ? AND (path = ? OR path LIKE ?)", bucketID, ".openlist", "%/.openlist").
		Delete(&models.FileMetadata{}).Error; err != nil {
		return fmt.Errorf("delete ignored metadata: %w", err)
	}

	prefixes := []string{"depot/", "depots/", "driver/", "drivers/", "iso/", "isos/", "output/"}
	for _, prefix := range prefixes {
		objects, err := s.listObjects(ctx, bucket, prefix)
		if err != nil {
			return err
		}

		for _, objectInfo := range objects {
			if !shouldIndexStorageObject(objectInfo.Key) {
				continue
			}
			metadata := objectInfoToMetadata(bucketID, objectInfo)
			if metadata.Type == "" {
				continue
			}
			if err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "storage_bucket_id"}, {Name: "path"}},
				DoUpdates: clause.AssignmentColumns([]string{
					"type",
					"esxi_version",
					"driver_category",
					"driver_type",
					"driver_name",
					"driver_description",
					"driver_version",
					"md5",
					"size",
					"etag",
					"last_modified",
					"updated_at",
				}),
			}).Create(&metadata).Error; err != nil {
				return fmt.Errorf("upsert metadata for %s: %w", objectInfo.Key, err)
			}
		}
	}

	return nil
}

func (s *FileService) getBucket(ctx context.Context, bucketID uint) (*models.StorageBucket, error) {
	if bucketID == 0 {
		return nil, fmt.Errorf("bucket id is required")
	}

	var bucket models.StorageBucket
	if err := s.db.WithContext(ctx).First(&bucket, bucketID).Error; err != nil {
		return nil, fmt.Errorf("find storage bucket: %w", err)
	}
	if bucket.Type == "" {
		bucket.Type = models.StorageTypeS3
	}
	return &bucket, nil
}

func (s *FileService) newS3ClientForBucket(bucket *models.StorageBucket) (*storage.S3Client, error) {
	client, err := storage.NewS3Client(&storage.S3Config{
		Endpoint:        bucket.Endpoint,
		AccessKeyID:     bucket.AccessKey,
		SecretAccessKey: bucket.SecretKey,
		BucketName:      bucket.BucketName,
		Region:          bucket.Region,
		UseSSL:          bucket.UseSSL,
		PublicDomain:    bucket.PublicDomain,
	})
	if err != nil {
		return nil, err
	}

	return client, nil
}

func (s *FileService) listObjects(ctx context.Context, bucket *models.StorageBucket, prefix string) ([]minio.ObjectInfo, error) {
	switch models.NormalizeStorageType(bucket.Type) {
	case models.StorageTypeLocal:
		store, err := storage.NewLocalStore(bucket.LocalPath)
		if err != nil {
			return nil, err
		}
		return store.ListObjects(ctx, prefix)
	case models.StorageTypeS3:
		client, err := s.newS3ClientForBucket(bucket)
		if err != nil {
			return nil, err
		}
		return client.ListObjects(ctx, prefix)
	default:
		return nil, fmt.Errorf("unsupported storage type: %s", bucket.Type)
	}
}

func (s *FileService) applyCacheStatus(ctx context.Context, bucketID uint, files []models.FileMetadata) error {
	if len(files) == 0 {
		return nil
	}

	bucket, err := s.getBucket(ctx, bucketID)
	if err != nil {
		return err
	}

	if models.NormalizeStorageType(bucket.Type) == models.StorageTypeLocal {
		for i := range files {
			files[i].Cached = true
			files[i].CacheValid = true
			files[i].CacheStatus = storage.CacheStatusCached
		}
		return nil
	}

	cacheRoot := strings.TrimSpace(s.cacheRoot)
	if cacheRoot == "" {
		cacheRoot = "./data/builds"
	}
	cacheManager := storage.NewCacheManager(filepath.Join(cacheRoot, "cache", fmt.Sprintf("bucket-%d", bucketID)), nil)
	for i := range files {
		objectInfo := minio.ObjectInfo{Key: files[i].Path, ETag: files[i].ETag, Size: files[i].Size}
		status, err := cacheManager.Status(files[i].Path, objectInfo)
		if err != nil {
			return fmt.Errorf("read cache status for %s: %w", files[i].Path, err)
		}
		files[i].Cached = status.Cached
		files[i].CacheValid = status.Valid
		files[i].CacheStatus = status.Status
	}
	return nil
}

func buildObjectPath(fileType, esxiVersion, driverCategory, filename string) (string, error) {
	cleanName := path.Base(filename)
	if cleanName == "." || cleanName == "/" || cleanName == "" {
		return "", fmt.Errorf("filename is required")
	}

	switch normalizeFileType(fileType) {
	case models.FileTypeDepot:
		if strings.TrimSpace(esxiVersion) != "" {
			return path.Join("depots", strings.TrimSpace(esxiVersion), cleanName), nil
		}
		return path.Join("depots", cleanName), nil
	case models.FileTypeDriver:
		if esxiVersion == "" {
			return "", fmt.Errorf("esxi version is required for driver uploads")
		}
		if driverCategory == "" {
			return "", fmt.Errorf("driver category is required for driver uploads")
		}
		return path.Join("drivers", esxiVersion, driverCategory, cleanName), nil
	case models.FileTypeISO:
		return path.Join("output", cleanName), nil
	default:
		return "", fmt.Errorf("unsupported file type: %s", fileType)
	}
}

func normalizeFileType(fileType string) string {
	switch strings.ToLower(fileType) {
	case models.FileTypeDepot:
		return models.FileTypeDepot
	case models.FileTypeDriver:
		return models.FileTypeDriver
	case models.FileTypeISO:
		return models.FileTypeISO
	default:
		return strings.ToLower(fileType)
	}
}

func detectContentType(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".iso":
		return "application/x-iso9660-image"
	case ".zip":
		return "application/zip"
	case ".gz", ".tgz":
		return "application/gzip"
	case ".vib":
		return "application/octet-stream"
	default:
		return "application/octet-stream"
	}
}

func objectInfoToMetadata(bucketID uint, objectInfo minio.ObjectInfo) models.FileMetadata {
	cleanPath := strings.TrimLeft(path.Clean(objectInfo.Key), "/")
	metadata := models.FileMetadata{
		StorageBucketID:   bucketID,
		Path:              cleanPath,
		Size:              objectInfo.Size,
		ETag:              objectInfo.ETag,
		DriverName:        displayNameFromFilename(cleanPath),
		DriverVersion:     versionTagFromFilename(cleanPath),
		DriverDescription: fileDescription(cleanPath, ""),
		MD5:               md5FromETag(objectInfo.ETag),
	}

	if !objectInfo.LastModified.IsZero() {
		lastModified := objectInfo.LastModified
		metadata.LastModified = &lastModified
	}

	prefix, version, category := splitStoragePath(cleanPath)
	switch {
	case isDepotPrefix(prefix):
		metadata.Type = models.FileTypeDepot
		metadata.ESXiVersion = version
		if inferred := inferESXiVersionFromDepotName(metadata.DriverName); inferred != "" {
			metadata.ESXiVersion = inferred
		}
		metadata.DriverDescription = fileDescription(cleanPath, models.FileTypeDepot)
	case isDriverPrefix(prefix) && strings.EqualFold(filepath.Ext(cleanPath), ".iso"):
		metadata.Type = models.FileTypeISO
		metadata.ESXiVersion = version
		metadata.DriverDescription = fileDescription(cleanPath, models.FileTypeISO)
	case isDriverPrefix(prefix):
		metadata.Type = models.FileTypeDriver
		metadata.ESXiVersion = version
		metadata.DriverCategory = category
		if metadata.DriverCategory == "" {
			metadata.DriverCategory = inferDriverCategory(metadata.DriverName)
		}
		metadata.DriverType = strings.TrimPrefix(strings.ToLower(filepath.Ext(cleanPath)), ".")
		metadata.DriverDescription = fileDescription(cleanPath, models.FileTypeDriver)
	case isISOPrefix(prefix):
		metadata.Type = models.FileTypeISO
		if prefix != "output" {
			metadata.ESXiVersion = version
		}
		metadata.DriverDescription = fileDescription(cleanPath, models.FileTypeISO)
	}

	return metadata
}

func splitStoragePath(objectPath string) (prefix, version, category string) {
	parts := strings.Split(strings.Trim(objectPath, "/"), "/")
	if len(parts) == 0 {
		return "", "", ""
	}
	prefix = strings.ToLower(parts[0])
	if len(parts) >= 3 {
		version = parts[1]
	}
	if len(parts) >= 4 {
		category = parts[2]
	}
	return prefix, version, category
}

func cleanRenameFilename(newName, oldPath string) (string, error) {
	cleanName := path.Base(strings.ReplaceAll(strings.TrimSpace(newName), "\\", "/"))
	if cleanName == "" || cleanName == "." || cleanName == "/" {
		return "", fmt.Errorf("filename is required")
	}
	if path.Ext(cleanName) == "" {
		cleanName += path.Ext(oldPath)
	}
	return cleanName, nil
}

func displayNameFromFilename(filename string) string {
	base := path.Base(strings.ReplaceAll(filename, "\\", "/"))
	ext := path.Ext(base)
	if ext == "" {
		return base
	}
	return strings.TrimSuffix(base, ext)
}

func versionTagFromFilename(filename string) string {
	name := displayNameFromFilename(filename)
	lower := strings.ToLower(name)
	for _, suffix := range []string{"-offline_bundle", "_offline_bundle", "-offline-bundle", "_offline-bundle"} {
		if strings.HasSuffix(lower, suffix) {
			return name[:len(name)-len(suffix)]
		}
	}
	return name
}

func fileDescription(objectPath, fileType string) string {
	name := strings.ToLower(displayNameFromFilename(objectPath))
	switch fileType {
	case models.FileTypeDepot:
		return "ESXi Depot升级包"
	case models.FileTypeDriver:
		switch {
		case strings.Contains(name, "vmkusb") || strings.Contains(name, "usb-nic") || strings.Contains(name, "usb_nic"):
			return "USB网卡驱动"
		case strings.HasPrefix(name, "net-") || strings.HasPrefix(name, "net_") || strings.Contains(name, "-nic") || strings.Contains(name, "_nic"):
			return "网卡驱动"
		case strings.Contains(name, "raid"):
			return "RAID驱动"
		case strings.HasPrefix(name, "scsi-") || strings.HasPrefix(name, "sata-") || strings.HasPrefix(name, "nvme-"):
			return "存储驱动"
		default:
			return "驱动包"
		}
	case models.FileTypeISO:
		return "ISO镜像"
	default:
		return objectPath
	}
}

var md5ETagPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

func md5FromETag(etag string) string {
	clean := strings.ToLower(strings.Trim(strings.TrimSpace(etag), `"`))
	if md5ETagPattern.MatchString(clean) {
		return clean
	}
	return ""
}

func inferESXiVersionFromDepotName(name string) string {
	upper := strings.ToUpper(name)
	switch {
	case strings.Contains(upper, "ESXI650"):
		return "6.5"
	case strings.Contains(upper, "ESXI670"):
		return "6.7"
	case strings.Contains(upper, "ESXI700"):
		return "7.0"
	case strings.Contains(upper, "ESXI800"):
		return "8.0"
	case strings.Contains(upper, "ESXI900"):
		return "9.0"
	default:
		return ""
	}
}

func shouldIndexStorageObject(objectPath string) bool {
	cleanPath := strings.TrimLeft(path.Clean(objectPath), "/")
	if cleanPath == "." || strings.HasSuffix(strings.TrimSpace(objectPath), "/") {
		return false
	}
	return path.Base(cleanPath) != ".openlist"
}

func inferDriverCategory(filename string) string {
	name := strings.ToLower(path.Base(filename))
	switch {
	case strings.HasPrefix(name, "net-") || strings.HasPrefix(name, "net_") || strings.Contains(name, "vmkusb") || strings.Contains(name, "usb-nic") || strings.Contains(name, "-nic"):
		return "network"
	case strings.HasPrefix(name, "scsi-") || strings.HasPrefix(name, "sata-") || strings.HasPrefix(name, "nvme-"):
		return "storage"
	case strings.Contains(name, "raid"):
		return "raid"
	default:
		return "other"
	}
}

func esxiVersionAliases(version string) []string {
	seen := make(map[string]struct{})
	aliases := make([]string, 0, 4)
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		aliases = append(aliases, value)
	}

	add(version)
	normalized := strings.ToLower(strings.TrimSpace(version))
	add(normalized)
	isBroadSix := normalized == "6x" || normalized == "6.x"

	major := normalized
	if before, _, ok := strings.Cut(major, "."); ok {
		major = before
	}
	major = strings.TrimSuffix(major, "x")
	if major == "" || major == normalized {
		return aliases
	}

	add(major + "x")
	add(major + ".x")
	if major == "6" && isBroadSix {
		add("6.5")
		add("6.7")
	} else if major != "6" {
		add(major + ".0")
	}
	return aliases
}

func isDepotPrefix(prefix string) bool {
	return prefix == "depot" || prefix == "depots"
}

func isDriverPrefix(prefix string) bool {
	return prefix == "driver" || prefix == "drivers"
}

func isISOPrefix(prefix string) bool {
	return prefix == "iso" || prefix == "isos" || prefix == "output"
}
