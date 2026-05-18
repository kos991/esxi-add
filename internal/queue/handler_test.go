package queue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
)

func TestValidateBuildInputFileAcceptsZipAndVibMagic(t *testing.T) {
	root := t.TempDir()
	zipPath := filepath.Join(root, "driver.zip")
	vibPath := filepath.Join(root, "driver.vib")

	if err := os.WriteFile(zipPath, []byte("PK\x03\x04zip-data"), 0o644); err != nil {
		t.Fatalf("write zip: %v", err)
	}
	if err := os.WriteFile(vibPath, []byte("!<arch>\nvib-data"), 0o644); err != nil {
		t.Fatalf("write vib: %v", err)
	}

	if err := ValidateBuildInputFile(zipPath, "driver/driver.zip"); err != nil {
		t.Fatalf("valid zip rejected: %v", err)
	}
	if err := ValidateBuildInputFile(vibPath, "driver/driver.vib"); err != nil {
		t.Fatalf("valid vib rejected: %v", err)
	}
}

func TestValidateBuildInputFileRejectsHtmlCachedAsDriver(t *testing.T) {
	path := filepath.Join(t.TempDir(), "driver.zip")
	if err := os.WriteFile(path, []byte("\n\n<!DOCTYPE html><html></html>"), 0o644); err != nil {
		t.Fatalf("write fake driver: %v", err)
	}

	err := ValidateBuildInputFile(path, "driver/6x/bad.zip")
	if err == nil {
		t.Fatal("expected invalid driver file to be rejected")
	}
	if !strings.Contains(err.Error(), "driver/6x/bad.zip") ||
		!strings.Contains(err.Error(), "not a valid .zip file") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildOutputFileNameSanitizesCustomName(t *testing.T) {
	got := BuildOutputFileName(`..\nested\custom`, "8.0")
	if got != "custom.iso" {
		t.Fatalf("expected sanitized ISO name custom.iso, got %q", got)
	}
}

func TestResolveStorageLocalUsesLocalStore(t *testing.T) {
	ctx := context.Background()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	root := t.TempDir()
	depotPath := filepath.Join(root, "depot", "offline.zip")
	if err := os.MkdirAll(filepath.Dir(depotPath), 0o755); err != nil {
		t.Fatalf("create depot dir: %v", err)
	}
	if err := os.WriteFile(depotPath, []byte("depot"), 0o644); err != nil {
		t.Fatalf("write depot: %v", err)
	}

	bucket := models.StorageBucket{
		Name:      "local",
		Type:      models.StorageTypeLocal,
		LocalPath: root,
	}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatalf("create bucket: %v", err)
	}

	handler := NewBuildTaskHandler(db, nil, t.TempDir(), nil)
	resolved, err := handler.resolveStorage(ctx, bucket.ID)
	if err != nil {
		t.Fatalf("resolve storage: %v", err)
	}

	got, err := resolved.EnsureFile(ctx, "depot/offline.zip")
	if err != nil {
		t.Fatalf("ensure file: %v", err)
	}
	if got != depotPath {
		t.Fatalf("expected local depot path %q, got %q", depotPath, got)
	}
}

func TestResolveStorageS3UsesBucketSpecificClient(t *testing.T) {
	ctx := context.Background()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	bucket := models.StorageBucket{
		Name:       "selected",
		Type:       models.StorageTypeS3,
		Endpoint:   "selected.example:9000",
		AccessKey:  "access",
		SecretKey:  "secret",
		BucketName: "selected",
		UseSSL:     false,
	}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatalf("create bucket: %v", err)
	}

	bucketS3 := &storage.S3Client{}
	originalNewS3Client := newBuildS3Client
	newBuildS3Client = func(cfg *storage.S3Config) (*storage.S3Client, error) {
		if cfg.BucketName != "selected" {
			t.Fatalf("expected selected bucket config, got %+v", cfg)
		}
		return bucketS3, nil
	}
	defer func() { newBuildS3Client = originalNewS3Client }()

	handler := NewBuildTaskHandler(db, nil, t.TempDir(), nil)

	resolved, err := handler.resolveStorage(ctx, bucket.ID)
	if err != nil {
		t.Fatalf("resolve storage: %v", err)
	}
	if resolved.uploader != bucketS3 {
		t.Fatal("expected selected S3 bucket client to be used for uploads")
	}
}

func TestStoreBuildOutputLocalWritesOutputAndComputesMetadata(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	store, err := newLocalBuildStorage(root)
	if err != nil {
		t.Fatalf("new local build storage: %v", err)
	}

	outputPath := filepath.Join(t.TempDir(), "custom.iso")
	content := []byte("iso bytes")
	if err := os.WriteFile(outputPath, content, 0o644); err != nil {
		t.Fatalf("write output: %v", err)
	}

	objectPath, shaValue, size, err := storeBuildOutput(ctx, store, outputPath, "custom.iso")
	if err != nil {
		t.Fatalf("store build output: %v", err)
	}

	if objectPath != "output/custom.iso" {
		t.Fatalf("expected output/custom.iso, got %q", objectPath)
	}
	if size != int64(len(content)) {
		t.Fatalf("expected size %d, got %d", len(content), size)
	}
	sum := sha256.Sum256(content)
	if shaValue != hex.EncodeToString(sum[:]) {
		t.Fatalf("expected sha %s, got %s", hex.EncodeToString(sum[:]), shaValue)
	}
	got, err := os.ReadFile(filepath.Join(root, "output", "custom.iso"))
	if err != nil {
		t.Fatalf("read stored output: %v", err)
	}
	if string(got) != string(content) {
		t.Fatalf("stored output content mismatch")
	}
}
