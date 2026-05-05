package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"path"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
)

type FileService struct {
	db       *gorm.DB
	s3Client *storage.S3Client
}

func NewFileService(db *gorm.DB, s3 *storage.S3Client) *FileService {
	return &FileService{db: db, s3Client: s3}
}

func (s *FileService) ListDepots(ctx context.Context, bucketID uint) ([]models.FileMetadata, error) {
	var files []models.FileMetadata
	err := s.db.WithContext(ctx).
		Where("storage_bucket_id = ? AND type = ?", bucketID, models.FileTypeDepot).
		Order("path ASC").
		Find(&files).Error
	return files, err
}

func (s *FileService) ListDrivers(ctx context.Context, bucketID uint, esxiVersion, category string) ([]models.FileMetadata, error) {
	query := s.db.WithContext(ctx).
		Where("storage_bucket_id = ? AND type = ?", bucketID, models.FileTypeDriver)

	if esxiVersion != "" {
		query = query.Where("esxi_version = ?", esxiVersion)
	}
	if category != "" {
		query = query.Where("driver_category = ?", category)
	}

	var files []models.FileMetadata
	err := query.Order("path ASC").Find(&files).Error
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

	hasher := sha256.New()
	var objectInfo minio.ObjectInfo
	var infoErr error
	switch normalizeStorageType(bucket.Type) {
	case models.StorageTypeLocal:
		store, err := storage.NewLocalStore(bucket.LocalPath)
		if err != nil {
			return nil, err
		}
		if err := store.Upload(ctx, objectPath, io.TeeReader(reader, hasher), size, detectContentType(filename)); err != nil {
			return nil, err
		}
		objectInfo, infoErr = store.GetObjectInfo(ctx, objectPath)
	case models.StorageTypeS3:
		client, err := s.newS3ClientForBucket(bucket)
		if err != nil {
			return nil, err
		}
		if err := client.Upload(ctx, objectPath, io.TeeReader(reader, hasher), size, detectContentType(filename)); err != nil {
			return nil, err
		}
		objectInfo, infoErr = client.GetObjectInfo(ctx, objectPath)
	default:
		return nil, fmt.Errorf("unsupported storage type: %s", bucket.Type)
	}

	metadata := &models.FileMetadata{
		StorageBucketID: bucket.ID,
		Path:            objectPath,
		Type:            normalizeFileType(fileType),
		ESXiVersion:     esxiVersion,
		DriverCategory:  driverCategory,
		DriverType:      strings.TrimPrefix(strings.ToLower(filepath.Ext(filename)), "."),
		DriverName:      path.Base(filename),
		SHA256:          hex.EncodeToString(hasher.Sum(nil)),
		Size:            size,
	}

	if infoErr == nil {
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

	switch normalizeStorageType(bucket.Type) {
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

func (s *FileService) RefreshCache(ctx context.Context, bucketID uint) error {
	bucket, err := s.getBucket(ctx, bucketID)
	if err != nil {
		return err
	}

	prefixes := []string{"depot/", "depots/", "driver/", "drivers/", "iso/", "isos/", "output/"}
	for _, prefix := range prefixes {
		objects, err := s.listObjects(ctx, bucket, prefix)
		if err != nil {
			return err
		}

		for _, objectInfo := range objects {
			metadata := objectInfoToMetadata(bucketID, objectInfo)
			if err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "storage_bucket_id"}, {Name: "path"}},
				DoUpdates: clause.AssignmentColumns([]string{
					"type",
					"esxi_version",
					"driver_category",
					"driver_type",
					"driver_name",
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
	switch normalizeStorageType(bucket.Type) {
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

func buildObjectPath(fileType, esxiVersion, driverCategory, filename string) (string, error) {
	cleanName := path.Base(filename)
	if cleanName == "." || cleanName == "/" || cleanName == "" {
		return "", fmt.Errorf("filename is required")
	}

	switch normalizeFileType(fileType) {
	case models.FileTypeDepot:
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

func normalizeStorageType(storageType string) string {
	switch strings.ToLower(strings.TrimSpace(storageType)) {
	case "", models.StorageTypeS3:
		return models.StorageTypeS3
	case models.StorageTypeLocal:
		return models.StorageTypeLocal
	default:
		return strings.ToLower(strings.TrimSpace(storageType))
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
		StorageBucketID: bucketID,
		Path:            cleanPath,
		Size:            objectInfo.Size,
		ETag:            objectInfo.ETag,
		DriverName:      path.Base(cleanPath),
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
	case isDriverPrefix(prefix) && strings.EqualFold(filepath.Ext(cleanPath), ".iso"):
		metadata.Type = models.FileTypeISO
		metadata.ESXiVersion = version
	case isDriverPrefix(prefix):
		metadata.Type = models.FileTypeDriver
		metadata.ESXiVersion = version
		metadata.DriverCategory = category
		metadata.DriverType = strings.TrimPrefix(strings.ToLower(filepath.Ext(cleanPath)), ".")
	case isISOPrefix(prefix):
		metadata.Type = models.FileTypeISO
		if prefix != "output" {
			metadata.ESXiVersion = version
		}
	}

	return metadata
}

func splitStoragePath(objectPath string) (prefix, version, category string) {
	parts := strings.Split(strings.Trim(objectPath, "/"), "/")
	if len(parts) == 0 {
		return "", "", ""
	}
	prefix = strings.ToLower(parts[0])
	if len(parts) >= 2 {
		version = parts[1]
	}
	if len(parts) >= 3 {
		category = parts[2]
	}
	return prefix, version, category
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
