package database

import (
	"fmt"
	"strings"

	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/config"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func EnsureDefaultStorageBucket(db *gorm.DB, cfg *config.Config) error {
	if db == nil {
		return fmt.Errorf("database is required")
	}
	if cfg == nil {
		return nil
	}

	storageType := strings.ToLower(strings.TrimSpace(cfg.Storage.Type))
	if storageType == "" {
		storageType = models.StorageTypeS3
	}

	var bucket models.StorageBucket
	switch storageType {
	case models.StorageTypeLocal:
		if strings.TrimSpace(cfg.Storage.LocalPath) == "" {
			return nil
		}
		bucket = models.StorageBucket{
			Name:      "Local Storage",
			Type:      models.StorageTypeLocal,
			LocalPath: strings.TrimSpace(cfg.Storage.LocalPath),
			IsDefault: true,
		}
	case models.StorageTypeS3:
		if cfg.Storage.S3.Endpoint == "" || cfg.Storage.S3.BucketName == "" {
			return nil
		}
		bucket = models.StorageBucket{
			Name:         cfg.Storage.S3.BucketName,
			Type:         models.StorageTypeS3,
			Endpoint:     cfg.Storage.S3.Endpoint,
			AccessKey:    cfg.Storage.S3.AccessKey,
			SecretKey:    cfg.Storage.S3.SecretKey,
			BucketName:   cfg.Storage.S3.BucketName,
			Region:       cfg.Storage.S3.Region,
			UseSSL:       cfg.Storage.S3.UseSSL,
			PublicDomain: cfg.Storage.S3.PublicDomain,
			IsDefault:    true,
		}
	default:
		return fmt.Errorf("unsupported storage type: %s", cfg.Storage.Type)
	}

	return db.Transaction(func(tx *gorm.DB) error {
		var existingDefaultCount int64
		if err := tx.Model(&models.StorageBucket{}).Where("is_default = ?", true).Count(&existingDefaultCount).Error; err != nil {
			return err
		}
		if existingDefaultCount == 0 {
			if err := tx.Model(&models.StorageBucket{}).Where("1 = 1").Update("is_default", false).Error; err != nil {
				return err
			}
		}

		var existing models.StorageBucket
		err := tx.Where("name = ?", bucket.Name).First(&existing).Error
		if err == nil {
			existing.Type = bucket.Type
			existing.Endpoint = bucket.Endpoint
			existing.AccessKey = bucket.AccessKey
			existing.SecretKey = bucket.SecretKey
			existing.BucketName = bucket.BucketName
			existing.Region = bucket.Region
			existing.UseSSL = bucket.UseSSL
			existing.PublicDomain = bucket.PublicDomain
			existing.LocalPath = bucket.LocalPath
			existing.IsDefault = existing.IsDefault || existingDefaultCount == 0
			return tx.Save(&existing).Error
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}

		bucket.IsDefault = existingDefaultCount == 0
		return tx.Create(&bucket).Error
	})
}
