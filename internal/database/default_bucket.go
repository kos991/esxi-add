package database

import (
	"fmt"

	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/config"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func EnsureDefaultStorageBucket(db *gorm.DB, cfg *config.Config) error {
	if db == nil {
		return fmt.Errorf("database is required")
	}
	if cfg == nil || cfg.Storage.S3.Endpoint == "" || cfg.Storage.S3.BucketName == "" {
		return nil
	}

	bucket := models.StorageBucket{
		Name:         cfg.Storage.S3.BucketName,
		Endpoint:     cfg.Storage.S3.Endpoint,
		AccessKey:    cfg.Storage.S3.AccessKey,
		SecretKey:    cfg.Storage.S3.SecretKey,
		BucketName:   cfg.Storage.S3.BucketName,
		Region:       cfg.Storage.S3.Region,
		UseSSL:       cfg.Storage.S3.UseSSL,
		PublicDomain: cfg.Storage.S3.PublicDomain,
		IsDefault:    true,
	}

	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.StorageBucket{}).Where("1 = 1").Update("is_default", false).Error; err != nil {
			return err
		}

		var existing models.StorageBucket
		err := tx.Where("name = ?", bucket.Name).First(&existing).Error
		if err == nil {
			existing.Endpoint = bucket.Endpoint
			existing.AccessKey = bucket.AccessKey
			existing.SecretKey = bucket.SecretKey
			existing.BucketName = bucket.BucketName
			existing.Region = bucket.Region
			existing.UseSSL = bucket.UseSSL
			existing.PublicDomain = bucket.PublicDomain
			existing.IsDefault = true
			return tx.Save(&existing).Error
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}

		return tx.Create(&bucket).Error
	})
}
