package services

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
)

// The supported deployment has one API process. Hold ownership through indexing
// so concurrent uploads cannot pair one request's hashes with another's bytes.
var activeUploads sync.Map

// Serializes scans with writes so a snapshot cannot erase newly committed metadata.
var storageMutationMu sync.RWMutex
var ErrUploadConflict = errors.New("an upload to this bucket/path is already in progress")

type s3ObjectArchiveClient interface {
	Upload(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) error
	GetObjectInfo(ctx context.Context, objectName string) (minio.ObjectInfo, error)
}

var newArchiveS3Client = func(cfg *storage.S3Config) (s3ObjectArchiveClient, error) {
	return storage.NewS3Client(cfg)
}

type ArchiveFileResult struct {
	File             *models.FileMetadata `json:"file"`
	SourceBucketID   uint                 `json:"source_bucket_id"`
	TargetBucketID   uint                 `json:"target_bucket_id"`
	TargetBucketName string               `json:"target_bucket_name"`
	CleanedLocal     bool                 `json:"cleaned_local"`
	FreedBytes       int64                `json:"freed_bytes"`
}

type ArchiveOutputsResult struct {
	TransferredCount int      `json:"transferred_count"`
	FreedBytes       int64    `json:"freed_bytes"`
	TargetBucketID   uint     `json:"target_bucket_id"`
	TargetBucketName string   `json:"target_bucket_name"`
	Paths            []string `json:"paths"`
}

type FileService struct {
	db        *gorm.DB
	s3Client  *storage.S3Client
	cacheRoot string
}

// StoredUploadError means the bytes have been committed but metadata could not
// be confirmed. Retrying the upload is not required; refresh/reconcile first.
type StoredUploadError struct {
	Metadata *models.FileMetadata
	Err      error
}

func (e *StoredUploadError) Error() string {
	return fmt.Sprintf("file stored at %s; metadata confirmation pending; refresh files before retrying: %v", e.Metadata.Path, e.Err)
}

func (e *StoredUploadError) Unwrap() error { return e.Err }

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

	uploadKey := fmt.Sprintf("%d:%s", bucketID, objectPath)
	if _, loaded := activeUploads.LoadOrStore(uploadKey, struct{}{}); loaded {
		return nil, ErrUploadConflict
	}
	defer activeUploads.Delete(uploadKey)
	storageMutationMu.Lock()
	defer storageMutationMu.Unlock()

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

	// Once storage succeeds, a disconnected request must not cancel indexing.
	// Keep the completion attempt bounded; expose partial success on failure.
	metadataCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	if err := s.db.WithContext(metadataCtx).Clauses(clause.OnConflict{
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
		return metadata, &StoredUploadError{Metadata: metadata, Err: fmt.Errorf("upsert file metadata: %w", err)}
	}

	if err := s.db.WithContext(metadataCtx).
		Where("storage_bucket_id = ? AND path = ?", bucket.ID, objectPath).
		First(metadata).Error; err != nil {
		return metadata, &StoredUploadError{Metadata: metadata, Err: fmt.Errorf("find file metadata: %w", err)}
	}

	return metadata, nil
}

func (s *FileService) DeleteFile(ctx context.Context, id uint) error {
	storageMutationMu.Lock()
	defer storageMutationMu.Unlock()
	var file models.FileMetadata
	if err := s.db.WithContext(ctx).First(&file, id).Error; err != nil {
		return err
	}

	if err := s.ensureUnreferenced(ctx, file); err != nil {
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

func (s *FileService) ResolveTargetS3Bucket(ctx context.Context, preferredID uint) (*models.StorageBucket, error) {
	var bucket models.StorageBucket
	if preferredID > 0 {
		if err := s.db.WithContext(ctx).First(&bucket, preferredID).Error; err != nil {
			return nil, fmt.Errorf("find target S3 bucket: %w", err)
		}
		if models.NormalizeStorageType(bucket.Type) != models.StorageTypeS3 {
			return nil, fmt.Errorf("目标存储节点「%s」不是 S3 对象存储", bucket.Name)
		}
		return &bucket, nil
	}
	if err := s.db.WithContext(ctx).
		Where("type = ? OR type = ''", models.StorageTypeS3).
		Order("is_default DESC, id ASC").
		First(&bucket).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("未配置可用的 S3 对象存储节点，请先在「存储与挂载」中挂载 S3")
		}
		return nil, fmt.Errorf("query S3 bucket: %w", err)
	}
	return &bucket, nil
}

func (s *FileService) ArchiveFileToS3(ctx context.Context, id uint, targetBucketID uint) (*ArchiveFileResult, error) {
	storageMutationMu.Lock()
	defer storageMutationMu.Unlock()

	var file models.FileMetadata
	if err := s.db.WithContext(ctx).First(&file, id).Error; err != nil {
		return nil, err
	}
	return s.archiveFileRecordToS3Unlocked(ctx, file, targetBucketID)
}

func (s *FileService) ArchiveLocalOutputsToS3(ctx context.Context, sourceBucketID uint, targetBucketID uint) (*ArchiveOutputsResult, error) {
	storageMutationMu.Lock()
	defer storageMutationMu.Unlock()

	targetBucket, err := s.ResolveTargetS3Bucket(ctx, targetBucketID)
	if err != nil {
		return nil, err
	}

	var localBuckets []models.StorageBucket
	q := s.db.WithContext(ctx).Where("type = ?", models.StorageTypeLocal)
	if sourceBucketID > 0 {
		q = q.Where("id = ?", sourceBucketID)
	}
	if err := q.Find(&localBuckets).Error; err != nil {
		return nil, err
	}
	if len(localBuckets) == 0 {
		return &ArchiveOutputsResult{
			TargetBucketID:   targetBucket.ID,
			TargetBucketName: targetBucket.Name,
			Paths:            []string{},
		}, nil
	}

	localIDs := make([]uint, 0, len(localBuckets))
	for _, b := range localBuckets {
		localIDs = append(localIDs, b.ID)
	}

	var files []models.FileMetadata
	if len(localIDs) > 0 {
		if err := s.db.WithContext(ctx).
			Where("storage_bucket_id IN ? AND (path LIKE 'output/%' OR path LIKE '/output/%' OR path LIKE 'build/%' OR path LIKE '/build/%')", localIDs).
			Order("id ASC").
			Find(&files).Error; err != nil {
			return nil, err
		}
	}

	res := &ArchiveOutputsResult{
		TargetBucketID:   targetBucket.ID,
		TargetBucketName: targetBucket.Name,
		Paths:            make([]string, 0, len(files)),
	}
	for _, f := range files {
		item, err := s.archiveFileRecordToS3Unlocked(ctx, f, targetBucket.ID)
		if err != nil {
			return nil, err
		}
		res.TransferredCount++
		res.FreedBytes += item.FreedBytes
		if item.File != nil && item.File.Path != "" {
			res.Paths = append(res.Paths, item.File.Path)
		} else {
			res.Paths = append(res.Paths, f.Path)
		}
	}

	// Scan any unindexed leftover files in local output/ or build/ directories
	for _, lb := range localBuckets {
		store, sErr := storage.NewLocalStore(lb.LocalPath)
		if sErr != nil {
			continue
		}
		for _, pfx := range []string{"output/", "build/"} {
			objs, lErr := store.ListObjects(ctx, pfx)
			if lErr != nil {
				continue
			}
			for _, obj := range objs {
				cleanPath := strings.TrimLeft(obj.Key, "/")
				if !strings.HasSuffix(strings.ToLower(cleanPath), ".iso") {
					continue
				}
				baseName := displayNameFromFilename(cleanPath)
				esxiVer := inferESXiVersionFromDepotName(baseName)
				if s.db.Migrator().HasTable(&models.BuildTask{}) {
					var task models.BuildTask
					if tErr := s.db.WithContext(ctx).Where("output_iso = ?", cleanPath).Order("id DESC").First(&task).Error; tErr == nil && task.ESXiVersion != "" {
						esxiVer = task.ESXiVersion
					}
				}
				synthetic := models.FileMetadata{
					StorageBucketID:   lb.ID,
					Path:              cleanPath,
					Type:              models.FileTypeISO,
					ESXiVersion:       esxiVer,
					DriverName:        baseName,
					DriverVersion:     baseName,
					DriverDescription: "ISO镜像",
					Size:              obj.Size,
				}
				item, aErr := s.archiveFileRecordToS3Unlocked(ctx, synthetic, targetBucket.ID)
				if aErr != nil {
					return nil, aErr
				}
				res.TransferredCount++
				res.FreedBytes += item.FreedBytes
				if item.File != nil && item.File.Path != "" {
					res.Paths = append(res.Paths, item.File.Path)
				}
			}
		}
	}

	// Also migrate any legacy output/*.iso objects already in S3 into build/*.iso
	migratedPaths, err := s.migrateS3LegacyOutputObjectsToBuildUnlocked(ctx, targetBucket)
	if err != nil {
		return nil, err
	}
	for _, mp := range migratedPaths {
		res.TransferredCount++
		res.Paths = append(res.Paths, mp)
	}
	return res, nil
}

func (s *FileService) migrateS3LegacyOutputObjectsToBuildUnlocked(ctx context.Context, targetBucket *models.StorageBucket) ([]string, error) {
	if targetBucket == nil || models.NormalizeStorageType(targetBucket.Type) != models.StorageTypeS3 {
		return nil, nil
	}
	client, err := s.newS3ClientForBucket(targetBucket)
	if err != nil {
		return nil, nil
	}
	objs, err := client.ListObjects(ctx, "output/")
	if err != nil {
		return nil, nil
	}
	var migrated []string
	for _, obj := range objs {
		oldKey := strings.TrimLeft(obj.Key, "/")
		if !strings.HasPrefix(strings.ToLower(oldKey), "output/") || strings.HasSuffix(oldKey, "/") {
			continue
		}
		newKey := normalizeS3BuildOutputPath(oldKey)
		if newKey == "" || newKey == oldKey {
			continue
		}
		if err := client.RenameObject(ctx, oldKey, newKey); err != nil {
			return migrated, fmt.Errorf("迁移 S3 镜像 %s 至 %s 失败: %w", oldKey, newKey, err)
		}
		migrated = append(migrated, newKey)
		now := time.Now()
		lm := obj.LastModified
		if lm.IsZero() {
			lm = now
		}
		baseName := displayNameFromFilename(newKey)
		esxiVer := inferESXiVersionFromDepotName(baseName)
		var shaVal string
		if s.db.Migrator().HasTable(&models.BuildTask{}) {
			var task models.BuildTask
			if err := s.db.WithContext(ctx).
				Where("output_iso IN ?", []string{oldKey, newKey}).
				Order("id DESC").
				First(&task).Error; err == nil {
				if task.ESXiVersion != "" {
					esxiVer = task.ESXiVersion
				}
				shaVal = task.OutputISOSHA256
			}
			_ = s.db.WithContext(ctx).Model(&models.BuildTask{}).
				Where("output_iso = ?", oldKey).
				Updates(map[string]any{
					"storage_bucket_id": targetBucket.ID,
					"output_iso":        newKey,
				}).Error
		}
		meta := models.FileMetadata{
			StorageBucketID:   targetBucket.ID,
			Path:              newKey,
			Type:              models.FileTypeISO,
			ESXiVersion:       esxiVer,
			DriverName:        baseName,
			DriverVersion:     baseName,
			DriverDescription: "ISO镜像",
			MD5:               md5FromETag(obj.ETag),
			SHA256:            shaVal,
			Size:              obj.Size,
			ETag:              obj.ETag,
			LastModified:      &lm,
		}
		_ = s.db.WithContext(ctx).Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "storage_bucket_id"}, {Name: "path"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"deleted_at",
				"type",
				"esxi_version",
				"driver_name",
				"driver_description",
				"driver_version",
				"md5",
				"sha256",
				"size",
				"etag",
				"last_modified",
				"updated_at",
			}),
		}).Create(&meta).Error
		_ = s.db.WithContext(ctx).Unscoped().
			Where("storage_bucket_id = ? AND path = ?", targetBucket.ID, oldKey).
			Delete(&models.FileMetadata{}).Error
	}
	return migrated, nil
}

func normalizeS3BuildOutputPath(objectPath string) string {
	clean := strings.TrimLeft(strings.ReplaceAll(strings.TrimSpace(objectPath), "\\", "/"), "/")
	low := strings.ToLower(clean)
	if strings.HasPrefix(low, "output/") || strings.HasPrefix(low, "build/") || strings.HasPrefix(low, "builds/") {
		base := path.Base(clean)
		if base != "" && base != "." && base != "/" {
			return path.Join("build", base)
		}
	}
	return clean
}

func (s *FileService) archiveFileRecordToS3Unlocked(ctx context.Context, file models.FileMetadata, targetBucketID uint) (*ArchiveFileResult, error) {
	sourceBucket, err := s.getBucket(ctx, file.StorageBucketID)
	if err != nil {
		return nil, err
	}
	targetBucket, err := s.ResolveTargetS3Bucket(ctx, targetBucketID)
	if err != nil {
		return nil, err
	}
	if models.NormalizeStorageType(sourceBucket.Type) != models.StorageTypeLocal {
		return &ArchiveFileResult{
			File:             &file,
			SourceBucketID:   sourceBucket.ID,
			TargetBucketID:   targetBucket.ID,
			TargetBucketName: targetBucket.Name,
			CleanedLocal:     true,
			FreedBytes:       0,
		}, nil
	}

	localStore, err := storage.NewLocalStore(sourceBucket.LocalPath)
	if err != nil {
		return nil, err
	}
	reader, err := localStore.Download(ctx, file.Path)
	if err != nil {
		return nil, fmt.Errorf("读取本地镜像失败 (%s): %w", file.Path, err)
	}
	defer reader.Close()

	objInfo, err := localStore.GetObjectInfo(ctx, file.Path)
	if err != nil {
		return nil, fmt.Errorf("获取本地镜像信息失败 (%s): %w", file.Path, err)
	}
	fileSize := objInfo.Size
	if fileSize <= 0 {
		fileSize = file.Size
	}

	s3Client, err := newArchiveS3Client(&storage.S3Config{
		Endpoint:        targetBucket.Endpoint,
		AccessKeyID:     targetBucket.AccessKey,
		SecretAccessKey: targetBucket.SecretKey,
		BucketName:      targetBucket.BucketName,
		Region:          targetBucket.Region,
		UseSSL:          targetBucket.UseSSL,
		PublicDomain:    targetBucket.PublicDomain,
	})
	if err != nil {
		return nil, err
	}

	targetS3Path := normalizeS3BuildOutputPath(file.Path)

	shaHasher := sha256.New()
	md5Hasher := md5.New()
	stream := io.TeeReader(reader, io.MultiWriter(shaHasher, md5Hasher))
	if err := s3Client.Upload(ctx, targetS3Path, stream, fileSize, detectContentType(targetS3Path)); err != nil {
		return nil, fmt.Errorf("上传镜像至 S3 失败: %w", err)
	}
	_ = reader.Close()

	now := time.Now()
	s3Meta := models.FileMetadata{
		StorageBucketID:   targetBucket.ID,
		Path:              targetS3Path,
		Type:              file.Type,
		ESXiVersion:       file.ESXiVersion,
		DriverCategory:    file.DriverCategory,
		DriverType:        file.DriverType,
		DriverName:        file.DriverName,
		DriverDescription: file.DriverDescription,
		DriverVersion:     file.DriverVersion,
		MD5:               hex.EncodeToString(md5Hasher.Sum(nil)),
		SHA256:            hex.EncodeToString(shaHasher.Sum(nil)),
		Size:              fileSize,
		LastModified:      &now,
	}
	if s3Meta.Type == "" {
		s3Meta.Type = models.FileTypeISO
	}
	if s3Info, infoErr := s3Client.GetObjectInfo(ctx, targetS3Path); infoErr == nil {
		s3Meta.ETag = s3Info.ETag
		if s3Info.Size > 0 {
			s3Meta.Size = s3Info.Size
		}
		if !s3Info.LastModified.IsZero() {
			lm := s3Info.LastModified
			s3Meta.LastModified = &lm
		}
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
			"md5",
			"sha256",
			"size",
			"etag",
			"last_modified",
			"updated_at",
		}),
	}).Create(&s3Meta).Error; err != nil {
		return nil, fmt.Errorf("保存 S3 镜像元数据失败: %w", err)
	}

	if s.db.Migrator().HasTable(&models.BuildTask{}) {
		archiveNote := fmt.Sprintf("ISO archived to S3 (%s: %s) and local generated ISO cleaned\n", targetBucket.Name, targetS3Path)
		_ = s.db.WithContext(ctx).Model(&models.BuildTask{}).
			Where("storage_bucket_id = ? AND output_iso IN ?", sourceBucket.ID, []string{file.Path, targetS3Path}).
			Updates(map[string]any{
				"storage_bucket_id": targetBucket.ID,
				"output_iso":        targetS3Path,
				"output_iso_size":   s3Meta.Size,
				"output_iso_sha256": s3Meta.SHA256,
				"log_output":        gorm.Expr("COALESCE(log_output, '') || ?", archiveNote),
			}).Error
	}

	if err := localStore.DeleteObject(ctx, file.Path); err != nil {
		return nil, fmt.Errorf("已上传至 S3，但清理本地镜像失败: %w", err)
	}
	_ = s.db.WithContext(ctx).Unscoped().Delete(&file).Error

	_ = s.db.WithContext(ctx).
		Where("storage_bucket_id = ? AND path = ?", targetBucket.ID, targetS3Path).
		First(&s3Meta).Error

	return &ArchiveFileResult{
		File:             &s3Meta,
		SourceBucketID:   sourceBucket.ID,
		TargetBucketID:   targetBucket.ID,
		TargetBucketName: targetBucket.Name,
		CleanedLocal:     true,
		FreedBytes:       fileSize,
	}, nil
}

type ArchiveBuildResult struct {
	Task             *models.BuildTask `json:"task"`
	TargetBucketID   uint              `json:"target_bucket_id"`
	TargetBucketName string            `json:"target_bucket_name"`
	CleanedLocal     bool              `json:"cleaned_local"`
	FreedBytes       int64             `json:"freed_bytes"`
}

func (s *FileService) ArchiveBuildArtifactToS3(ctx context.Context, taskIdentifier string, targetBucketID uint) (*ArchiveBuildResult, error) {
	storageMutationMu.Lock()
	defer storageMutationMu.Unlock()

	var task models.BuildTask
	if err := s.db.WithContext(ctx).Where("task_id = ?", taskIdentifier).First(&task).Error; err != nil {
		return nil, err
	}
	if task.Status != models.BuildTaskStatusCompleted || strings.TrimSpace(task.OutputISO) == "" {
		return nil, fmt.Errorf("构建任务尚未生成可用的 ISO 产物")
	}

	targetBucket, err := s.ResolveTargetS3Bucket(ctx, targetBucketID)
	if err != nil {
		return nil, err
	}

	var currentBucket models.StorageBucket
	if err := s.db.WithContext(ctx).First(&currentBucket, task.StorageBucketID).Error; err != nil {
		return nil, fmt.Errorf("find task storage bucket: %w", err)
	}

	var freedBytes int64
	if models.NormalizeStorageType(currentBucket.Type) == models.StorageTypeLocal {
		var localMeta models.FileMetadata
		err := s.db.WithContext(ctx).
			Where("storage_bucket_id = ? AND path = ?", currentBucket.ID, task.OutputISO).
			First(&localMeta).Error
		if err != nil {
			baseName := displayNameFromFilename(task.OutputISO)
			localMeta = models.FileMetadata{
				StorageBucketID:   currentBucket.ID,
				Path:              task.OutputISO,
				Type:              models.FileTypeISO,
				ESXiVersion:       task.ESXiVersion,
				DriverName:        baseName,
				DriverVersion:     baseName,
				DriverDescription: "ISO镜像",
				SHA256:            task.OutputISOSHA256,
				Size:              task.OutputISOSize,
			}
		}
		res, err := s.archiveFileRecordToS3Unlocked(ctx, localMeta, targetBucket.ID)
		if err != nil {
			return nil, err
		}
		freedBytes = res.FreedBytes
	} else {
		// If task already points to S3 under legacy output/, move it to build/
		oldS3Key := strings.TrimLeft(task.OutputISO, "/")
		newS3Key := normalizeS3BuildOutputPath(oldS3Key)
		if newS3Key != "" && newS3Key != oldS3Key {
			if client, cErr := s.newS3ClientForBucket(targetBucket); cErr == nil {
				if rErr := client.RenameObject(ctx, oldS3Key, newS3Key); rErr == nil {
					_ = s.db.WithContext(ctx).Model(&models.BuildTask{}).
						Where("task_id = ?", task.TaskID).
						Update("output_iso", newS3Key).Error
					_ = s.db.WithContext(ctx).Model(&models.FileMetadata{}).
						Where("storage_bucket_id = ? AND path = ?", targetBucket.ID, oldS3Key).
						Update("path", newS3Key).Error
				}
			}
		}
		// Even if task already points to S3, ensure any leftover same-named ISO in local buckets is cleaned.
		baseName := path.Base(strings.ReplaceAll(task.OutputISO, "\\", "/"))
		candidatePaths := []string{task.OutputISO}
		for _, pfx := range []string{"build", "output"} {
			alt := path.Join(pfx, baseName)
			if alt != task.OutputISO {
				candidatePaths = append(candidatePaths, alt)
			}
		}
		var localBuckets []models.StorageBucket
		_ = s.db.WithContext(ctx).Where("type = ?", models.StorageTypeLocal).Find(&localBuckets).Error
		for _, lb := range localBuckets {
			if store, sErr := storage.NewLocalStore(lb.LocalPath); sErr == nil {
				for _, p := range candidatePaths {
					if info, iErr := store.GetObjectInfo(ctx, p); iErr == nil {
						freedBytes += info.Size
					}
					_ = store.DeleteObject(ctx, p)
				}
			}
			_ = s.db.WithContext(ctx).Unscoped().
				Where("storage_bucket_id = ? AND path IN ?", lb.ID, candidatePaths).
				Delete(&models.FileMetadata{}).Error
		}
	}

	_ = s.db.WithContext(ctx).Where("task_id = ?", task.TaskID).First(&task).Error
	return &ArchiveBuildResult{
		Task:             &task,
		TargetBucketID:   targetBucket.ID,
		TargetBucketName: targetBucket.Name,
		CleanedLocal:     true,
		FreedBytes:       freedBytes,
	}, nil
}

func (s *FileService) RenameFile(ctx context.Context, id uint, newName string) (*models.FileMetadata, error) {
	storageMutationMu.Lock()
	defer storageMutationMu.Unlock()
	var file models.FileMetadata
	if err := s.db.WithContext(ctx).First(&file, id).Error; err != nil {
		return nil, err
	}

	if err := s.ensureUnreferenced(ctx, file); err != nil {
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
		"md5":                file.MD5,
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
		return path.Join("build", cleanName), nil
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
		metadata.DriverCategory = category
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
		if !isBuildOutputPrefix(prefix) {
			metadata.ESXiVersion = version
			metadata.DriverCategory = category
		}
		metadata.DriverDescription = fileDescription(cleanPath, models.FileTypeISO)
	}

	// Outside managed prefixes, use extension plus an explicit ESXi depot name.
	ext := strings.ToLower(path.Ext(cleanPath))
	switch ext {
	case ".iso":
		if metadata.Type == "" {
			metadata.Type = models.FileTypeISO
		}
	case ".vib":
		if metadata.Type == "" {
			metadata.Type = models.FileTypeDriver
			metadata.DriverType = "vib"
		}
	case ".zip":
		if metadata.Type == "" {
			name := strings.ToLower(path.Base(cleanPath))
			if strings.Contains(name, "esxi") && strings.Contains(name, "depot") {
				metadata.Type = models.FileTypeDepot
			} else {
				metadata.Type = "unknown"
			}
		}
	default:
		metadata.Type = ""
	}
	if metadata.ESXiVersion == "" {
		metadata.ESXiVersion = inferESXiVersionFromDepotName(metadata.DriverName)
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
	if len(newName) > 255 || strings.ContainsAny(newName, "/\\\x00\r\n:") {
		return "", fmt.Errorf("invalid filename")
	}
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

func inferSourceCategory(objectPath, fileType string) string {
	low := strings.ToLower(objectPath)
	name := strings.ToLower(path.Base(objectPath))
	switch {
	case strings.Contains(low, "/oem-dell/") || strings.Contains(name, "dell"):
		return "oem-dell"
	case strings.Contains(low, "/oem-h3c/") || strings.HasPrefix(name, "h3c-"):
		return "oem-h3c"
	case strings.Contains(low, "/oem-inspur/") || strings.Contains(name, "inspur"):
		return "oem-inspur"
	case strings.Contains(low, "/oem-hpe/") || strings.Contains(name, "-hpe-"):
		return "oem-hpe"
	case fileType == models.FileTypeDepot:
		return "official-patch"
	default:
		return "official"
	}
}

func fileDescription(objectPath, fileType string) string {
	low := strings.ToLower(objectPath)
	name := strings.ToLower(displayNameFromFilename(objectPath))
	switch fileType {
	case models.FileTypeDepot:
		switch inferSourceCategory(objectPath, models.FileTypeDepot) {
		case "oem-dell":
			return "Dell 定制离线包"
		case "oem-h3c":
			return "H3C 定制离线包"
		case "oem-inspur":
			return "浪潮定制离线包"
		case "oem-hpe":
			return "HPE 定制离线包"
		default:
			return "官方升级补丁包"
		}
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
		case strings.Contains(name, "addon"):
			return "OEM硬件扩展包"
		case strings.Contains(low, "/community/"):
			return "社区驱动"
		case strings.Contains(low, "/raid/"):
			return "阵列卡驱动"
		case strings.Contains(low, "/network/"):
			return "服务器网卡驱动"
		case strings.Contains(low, "/storage/"):
			return "存储控制器驱动"
		default:
			return "驱动包"
		}
	case models.FileTypeISO:
		trimmedLow := strings.TrimLeft(low, "/")
		if strings.HasPrefix(trimmedLow, "build/") || strings.HasPrefix(trimmedLow, "builds/") || strings.HasPrefix(trimmedLow, "output/") {
			return "ISO镜像"
		}
		switch inferSourceCategory(objectPath, models.FileTypeISO) {
		case "oem-dell":
			return "Dell 定制 ISO"
		case "oem-h3c":
			return "H3C 定制 ISO"
		case "oem-inspur":
			return "浪潮定制 ISO"
		case "oem-hpe":
			return "HPE 定制 ISO"
		case "official":
			if strings.Contains(low, "isos/") {
				return "官方原版 ISO"
			}
			return "ISO镜像"
		default:
			return "ISO镜像"
		}
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
	if match := regexp.MustCompile(`(?i)esxi[-_ ]?(6\.[57]|[789]\.0)(?:[^0-9]|$)`).FindStringSubmatch(name); len(match) > 1 {
		return match[1]
	}
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

func isBuildOutputPrefix(prefix string) bool {
	return prefix == "build" || prefix == "builds" || prefix == "output"
}

func isISOPrefix(prefix string) bool {
	return prefix == "iso" || prefix == "isos" || isBuildOutputPrefix(prefix)
}

// Only well-known VMware driver archive names count; anything else stays unknown.
func looksLikeDriverArchive(name string) bool {
 for _, prefix := range []string{"net-", "net_", "scsi-", "sata-", "nvme-", "vmkusb", "usb-nic", "usb_nic", "raid"} {
  if strings.HasPrefix(name, prefix) || strings.Contains(name, prefix) { return true }
 }
 return false
}
