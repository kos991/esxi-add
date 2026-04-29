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
    client, bucket, err := s.getClientForBucket(ctx, bucketID)
    if err != nil {
        return nil, err
    }

    objectPath, err := buildObjectPath(fileType, esxiVersion, driverCategory, filename)
    if err != nil {
        return nil, err
    }

    hasher := sha256.New()
    if err := client.Upload(ctx, objectPath, io.TeeReader(reader, hasher), size, detectContentType(filename)); err != nil {
        return nil, err
    }

    sha256Value := hex.EncodeToString(hasher.Sum(nil))
    objectInfo, infoErr := client.GetObjectInfo(ctx, objectPath)

    metadata := &models.FileMetadata{
        StorageBucketID:   bucket.ID,
        Path:              objectPath,
        Type:              normalizeFileType(fileType),
        ESXiVersion:       esxiVersion,
        DriverCategory:    driverCategory,
        DriverType:        strings.TrimPrefix(strings.ToLower(filepath.Ext(filename)), "."),
        DriverName:        path.Base(filename),
        SHA256:            sha256Value,
        Size:              size,
    }

    if infoErr == nil {
        metadata.ETag = objectInfo.ETag
        metadata.Size = objectInfo.Size
        lastModified := objectInfo.LastModified
        metadata.LastModified = &lastModified
    }

    if err := s.db.WithContext(ctx).Create(metadata).Error; err != nil {
        return nil, fmt.Errorf("create file metadata: %w", err)
    }

    return metadata, nil
}

func (s *FileService) DeleteFile(ctx context.Context, id uint) error {
    var file models.FileMetadata
    if err := s.db.WithContext(ctx).First(&file, id).Error; err != nil {
        return err
    }

    client, _, err := s.getClientForBucket(ctx, file.StorageBucketID)
    if err != nil {
        return err
    }

    if err := client.DeleteObject(ctx, file.Path); err != nil {
        return err
    }

    if err := s.db.WithContext(ctx).Delete(&file).Error; err != nil {
        return fmt.Errorf("delete file metadata: %w", err)
    }

    return nil
}

func (s *FileService) RefreshCache(ctx context.Context, bucketID uint) error {
    client, _, err := s.getClientForBucket(ctx, bucketID)
    if err != nil {
        return err
    }

    prefixes := []string{"depots/", "drivers/", "output/"}
    for _, prefix := range prefixes {
        objects, err := client.ListObjects(ctx, prefix)
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

func (s *FileService) getClientForBucket(ctx context.Context, bucketID uint) (*storage.S3Client, *models.StorageBucket, error) {
    if bucketID == 0 {
        return nil, nil, fmt.Errorf("bucket id is required")
    }

    var bucket models.StorageBucket
    if err := s.db.WithContext(ctx).First(&bucket, bucketID).Error; err != nil {
        return nil, nil, fmt.Errorf("find storage bucket: %w", err)
    }

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
        return nil, nil, err
    }

    return client, &bucket, nil
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
    metadata := models.FileMetadata{
        StorageBucketID: bucketID,
        Path:            objectInfo.Key,
        Size:            objectInfo.Size,
        ETag:            objectInfo.ETag,
        DriverName:      path.Base(objectInfo.Key),
    }

    if !objectInfo.LastModified.IsZero() {
        lastModified := objectInfo.LastModified
        metadata.LastModified = &lastModified
    }

    switch {
    case strings.HasPrefix(objectInfo.Key, "depots/"):
        metadata.Type = models.FileTypeDepot
    case strings.HasPrefix(objectInfo.Key, "drivers/"):
        metadata.Type = models.FileTypeDriver
        parts := strings.Split(objectInfo.Key, "/")
        if len(parts) >= 4 {
            metadata.ESXiVersion = parts[1]
            metadata.DriverCategory = parts[2]
        }
        metadata.DriverType = strings.TrimPrefix(strings.ToLower(filepath.Ext(objectInfo.Key)), ".")
    case strings.HasPrefix(objectInfo.Key, "output/"):
        metadata.Type = models.FileTypeISO
    }

    return metadata
}
