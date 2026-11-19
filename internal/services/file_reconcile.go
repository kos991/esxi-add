package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
	"gorm.io/gorm"
)

func (s *FileService) RefreshCache(ctx context.Context, bucketID uint) error {
	storageMutationMu.Lock()
	defer storageMutationMu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	bucket, err := s.getBucket(ctx, bucketID)
	if err != nil {
		return err
	}
	objects, err := s.listObjects(ctx, bucket, "")
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var previous []models.FileMetadata
		if err := tx.Where("storage_bucket_id = ?", bucketID).Find(&previous).Error; err != nil {
			return err
		}
		seen := make(map[string]bool)
		for _, object := range objects {
			if !shouldIndexStorageObject(object.Key) {
				continue
			}
			seen[object.Key] = true
			if _, active := activeUploads.Load(fmt.Sprintf("%d:%s", bucketID, object.Key)); active {
				continue
			}
			metadata := objectInfoToMetadata(bucketID, object)
			if metadata.Type == "" {
				continue
			}
			var existing models.FileMetadata
			err := tx.Unscoped().Where("storage_bucket_id = ? AND path = ?", bucketID, metadata.Path).First(&existing).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if err == nil {
				metadata.ID = existing.ID
				metadata.CreatedAt = existing.CreatedAt
				metadata.MD5, metadata.SHA256 = existing.MD5, existing.SHA256
				if existing.ESXiVersion != "" {
					metadata.ESXiVersion = existing.ESXiVersion
				}
			}
			// Completed task metadata is authoritative for generated artifacts.
			if tx.Migrator().HasTable(&models.BuildTask{}) {
				var task models.BuildTask
				if err := tx.Where("storage_bucket_id = ? AND output_iso = ? AND status = ?", bucketID, metadata.Path, models.BuildTaskStatusCompleted).Order("id DESC").First(&task).Error; err == nil {
					metadata.ESXiVersion = task.ESXiVersion
					if task.OutputISOSHA256 != "" {
						metadata.SHA256 = task.OutputISOSHA256
					}
				} else if err != gorm.ErrRecordNotFound {
					return err
				}
			}
			if err := tx.Unscoped().Save(&metadata).Error; err != nil {
				return err
			}
		}
		for _, old := range previous {
			if seen[old.Path] {
				continue
			}
			if _, active := activeUploads.Load(fmt.Sprintf("%d:%s", bucketID, old.Path)); active {
				continue
			}
			if err := tx.Delete(&old).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *FileService) ensureUnreferenced(ctx context.Context, file models.FileMetadata) error {
	if !s.db.Migrator().HasTable(&models.BuildTask{}) {
		return nil
	}
	var tasks []models.BuildTask
	if err := s.db.WithContext(ctx).Where("storage_bucket_id = ?", file.StorageBucketID).Find(&tasks).Error; err != nil {
		return err
	}
	for _, task := range tasks {
		referenced := task.OutputISO == file.Path || task.DepotPath == file.Path
		var drivers []string
		if err := json.Unmarshal([]byte(task.Drivers), &drivers); err == nil {
			for _, driver := range drivers {
				referenced = referenced || driver == file.Path
			}
		}
		if referenced {
			return fmt.Errorf("文件被构建任务 %s 引用，不能重命名或删除", task.TaskID)
		}
	}
	return nil
}

// ListFiles includes unknown ZIPs; only explicitly categorized driver/depot ZIPs are build inputs.
func (s *FileService) ListFiles(ctx context.Context, bucketID uint) ([]models.FileMetadata, error) {
	var files []models.FileMetadata
	err := s.db.WithContext(ctx).Where("storage_bucket_id = ?", bucketID).Order("path ASC").Find(&files).Error
	return files, err
}

func (s *FileService) OpenFile(ctx context.Context, id uint) (io.ReadCloser, string, error) {
	var file models.FileMetadata
	if err := s.db.WithContext(ctx).First(&file, id).Error; err != nil {
		return nil, "", err
	}
	key := file.Path
	if key == "" || len(key) > 4096 || strings.ContainsAny(key, "\x00\\\r\n") || strings.HasPrefix(key, "/") || path.Clean(key) != key || key == ".." || strings.HasPrefix(key, "../") {
		return nil, "", fmt.Errorf("invalid object path")
	}
	bucket, err := s.getBucket(ctx, file.StorageBucketID)
	if err != nil {
		return nil, "", err
	}
	var reader io.ReadCloser
	switch models.NormalizeStorageType(bucket.Type) {
	case models.StorageTypeLocal:
		store, err := storage.NewLocalStore(bucket.LocalPath)
		if err != nil {
			return nil, "", err
		}
		reader, err = store.Download(ctx, key)
		if err != nil {
			return nil, "", err
		}
	case models.StorageTypeS3:
		client, err := s.newS3ClientForBucket(bucket)
		if err != nil {
			return nil, "", err
		}
		reader, err = client.Download(ctx, key)
		if err != nil {
			return nil, "", err
		}
	default:
		return nil, "", fmt.Errorf("unsupported storage type")
	}
	return reader, path.Base(key), nil
}

type PresignedURLResult struct {
	URL            string `json:"url"`
	Signed         bool   `json:"signed"`
	ExpiresSeconds int    `json:"expires_seconds"`
	ObjectPath     string `json:"object_path"`
	Filename       string `json:"filename"`
}

func (s *FileService) GetFilePresignedURL(ctx context.Context, id uint, expires time.Duration) (*PresignedURLResult, error) {
	var file models.FileMetadata
	if err := s.db.WithContext(ctx).First(&file, id).Error; err != nil {
		return nil, err
	}
	return s.GetBucketObjectPresignedURL(ctx, file.StorageBucketID, file.Path, expires)
}

func (s *FileService) GetBucketObjectPresignedURL(ctx context.Context, bucketID uint, objectPath string, expires time.Duration) (*PresignedURLResult, error) {
	cleanPath := strings.TrimLeft(strings.TrimSpace(objectPath), "/")
	if cleanPath == "" {
		return nil, fmt.Errorf("object path is required")
	}

	var bucket *models.StorageBucket
	if bucketID > 0 {
		b, err := s.getBucket(ctx, bucketID)
		if err == nil {
			bucket = b
		}
	}
	if bucket == nil || models.NormalizeStorageType(bucket.Type) != models.StorageTypeS3 {
		s3Bucket, err := s.ResolveTargetS3Bucket(ctx, 0)
		if err != nil {
			return nil, err
		}
		bucket = s3Bucket
	}

	if expires <= 0 {
		expires = 24 * time.Hour
	}
	filename := path.Base(strings.ReplaceAll(cleanPath, "\\", "/"))
	client, err := s.newS3ClientForBucket(bucket)
	if err != nil {
		return nil, err
	}
	signedURL, err := client.GetPresignedDownloadURL(ctx, cleanPath, expires, filename)
	if err != nil {
		return nil, err
	}
	return &PresignedURLResult{
		URL:            signedURL,
		Signed:         true,
		ExpiresSeconds: int(expires.Seconds()),
		ObjectPath:     cleanPath,
		Filename:       filename,
	}, nil
}
