package database

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/config"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func TestEnsureDefaultStorageBucketCreatesConfiguredBucket(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	cfg := &config.Config{}
	cfg.Storage.S3.Endpoint = "minio:9000"
	cfg.Storage.S3.AccessKey = "minioadmin"
	cfg.Storage.S3.SecretKey = "miniosecret"
	cfg.Storage.S3.BucketName = "esxi-builder"
	cfg.Storage.S3.Region = "us-east-1"
	cfg.Storage.S3.PublicDomain = "http://localhost:9000"

	if err := EnsureDefaultStorageBucket(db, cfg); err != nil {
		t.Fatalf("ensure default bucket: %v", err)
	}

	var bucket models.StorageBucket
	if err := db.First(&bucket).Error; err != nil {
		t.Fatalf("find default bucket: %v", err)
	}
	if bucket.Name != "esxi-builder" ||
		bucket.Endpoint != "minio:9000" ||
		bucket.AccessKey != "minioadmin" ||
		bucket.SecretKey != "miniosecret" ||
		bucket.BucketName != "esxi-builder" ||
		bucket.Region != "us-east-1" ||
		bucket.PublicDomain != "http://localhost:9000" ||
		!bucket.IsDefault {
		t.Fatalf("unexpected default bucket: %+v", bucket)
	}
}

func TestEnsureDefaultStorageBucketCreatesConfiguredLocalBucket(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	localPath := filepath.Join(t.TempDir(), "storage")
	cfg := &config.Config{}
	cfg.Storage.Type = models.StorageTypeLocal
	cfg.Storage.LocalPath = localPath

	if err := EnsureDefaultStorageBucket(db, cfg); err != nil {
		t.Fatalf("ensure default local bucket: %v", err)
	}

	var bucket models.StorageBucket
	if err := db.First(&bucket).Error; err != nil {
		t.Fatalf("find default local bucket: %v", err)
	}
	if bucket.Name != "Local Storage" ||
		bucket.Type != models.StorageTypeLocal ||
		bucket.LocalPath != localPath ||
		!bucket.IsDefault {
		t.Fatalf("unexpected default local bucket: %+v", bucket)
	}
}
