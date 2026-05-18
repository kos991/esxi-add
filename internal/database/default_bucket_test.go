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

func TestEnsureDefaultStorageBucketDoesNotOverrideExistingDefault(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	userDefault := models.StorageBucket{
		Name:      "User Local",
		Type:      models.StorageTypeLocal,
		LocalPath: filepath.Join(t.TempDir(), "user-storage"),
		IsDefault: true,
	}
	if err := db.Create(&userDefault).Error; err != nil {
		t.Fatalf("create user default: %v", err)
	}

	cfg := &config.Config{}
	cfg.Storage.Type = models.StorageTypeLocal
	cfg.Storage.LocalPath = filepath.Join(t.TempDir(), "configured-storage")

	if err := EnsureDefaultStorageBucket(db, cfg); err != nil {
		t.Fatalf("ensure default local bucket: %v", err)
	}

	var buckets []models.StorageBucket
	if err := db.Order("id ASC").Find(&buckets).Error; err != nil {
		t.Fatalf("list buckets: %v", err)
	}
	if len(buckets) != 2 {
		t.Fatalf("expected configured bucket to be created without replacing existing default, got %+v", buckets)
	}
	if !buckets[0].IsDefault {
		t.Fatalf("existing user default should stay default: %+v", buckets)
	}
	if buckets[1].IsDefault {
		t.Fatalf("configured bucket should not become default when one already exists: %+v", buckets)
	}
}

func TestEnsureDefaultStorageBucketKeepsConfiguredBucketDefaultOnRestart(t *testing.T) {
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
		t.Fatalf("first ensure default local bucket: %v", err)
	}
	if err := EnsureDefaultStorageBucket(db, cfg); err != nil {
		t.Fatalf("second ensure default local bucket: %v", err)
	}

	var bucket models.StorageBucket
	if err := db.Where("name = ?", "Local Storage").First(&bucket).Error; err != nil {
		t.Fatalf("find configured bucket: %v", err)
	}
	if !bucket.IsDefault {
		t.Fatalf("configured bucket should stay default across restarts: %+v", bucket)
	}
}
