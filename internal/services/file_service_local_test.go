package services

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func newLocalFileServiceTestDB(t *testing.T, localPath string) (*gorm.DB, uint) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}, &models.FileMetadata{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	bucket := models.StorageBucket{
		Name:      "Local",
		Type:      models.StorageTypeLocal,
		LocalPath: localPath,
		IsDefault: true,
	}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatalf("create bucket: %v", err)
	}
	return db, bucket.ID
}

func TestFileServiceUploadAndDeleteLocalFile(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)
	service := NewFileService(db, nil)

	metadata, err := service.UploadFile(context.Background(), bucketID, models.FileTypeDepot, "", "", "VMware-ESXi.zip", strings.NewReader("depot-data"), int64(len("depot-data")))
	if err != nil {
		t.Fatalf("upload local file: %v", err)
	}
	if metadata.Path != "depots/VMware-ESXi.zip" || metadata.SHA256 == "" {
		t.Fatalf("unexpected metadata: %+v", metadata)
	}
	if _, err := os.Stat(filepath.Join(root, "depots", "VMware-ESXi.zip")); err != nil {
		t.Fatalf("uploaded local object missing: %v", err)
	}

	if err := service.DeleteFile(context.Background(), metadata.ID); err != nil {
		t.Fatalf("delete local file: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "depots", "VMware-ESXi.zip")); !os.IsNotExist(err) {
		t.Fatalf("expected local object deleted, got %v", err)
	}
}

func TestFileServiceUploadLocalFileUpdatesExistingMetadata(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)
	service := NewFileService(db, nil)

	first, err := service.UploadFile(context.Background(), bucketID, models.FileTypeDepot, "", "", "VMware-ESXi.zip", strings.NewReader("old"), int64(len("old")))
	if err != nil {
		t.Fatalf("first upload local file: %v", err)
	}

	second, err := service.UploadFile(context.Background(), bucketID, models.FileTypeDepot, "", "", "VMware-ESXi.zip", strings.NewReader("new-data"), int64(len("new-data")))
	if err != nil {
		t.Fatalf("second upload local file: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected duplicate upload to update existing metadata ID %d, got %d", first.ID, second.ID)
	}
	if second.Size != int64(len("new-data")) || second.SHA256 == first.SHA256 {
		t.Fatalf("expected metadata to reflect updated file, got first=%+v second=%+v", first, second)
	}

	var count int64
	if err := db.Model(&models.FileMetadata{}).Where("storage_bucket_id = ? AND path = ?", bucketID, "depots/VMware-ESXi.zip").Count(&count).Error; err != nil {
		t.Fatalf("count metadata rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one metadata row, got %d", count)
	}

	got, err := os.ReadFile(filepath.Join(root, "depots", "VMware-ESXi.zip"))
	if err != nil {
		t.Fatalf("read uploaded local object: %v", err)
	}
	if string(got) != "new-data" {
		t.Fatalf("expected overwritten object content, got %q", string(got))
	}
}

func TestFileServiceRefreshCacheIndexesLocalFiles(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)
	if err := os.MkdirAll(filepath.Join(root, "drivers", "8.0", "network"), 0o755); err != nil {
		t.Fatalf("mkdir drivers: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "drivers", "8.0", "network", "net.vib"), []byte("driver"), 0o644); err != nil {
		t.Fatalf("write driver: %v", err)
	}

	service := NewFileService(db, nil)
	if err := service.RefreshCache(context.Background(), bucketID); err != nil {
		t.Fatalf("refresh local cache: %v", err)
	}

	var file models.FileMetadata
	if err := db.Where("storage_bucket_id = ? AND path = ?", bucketID, "drivers/8.0/network/net.vib").First(&file).Error; err != nil {
		t.Fatalf("find indexed local file: %v", err)
	}
	if file.Type != models.FileTypeDriver || file.ESXiVersion != "8.0" || file.DriverCategory != "network" {
		t.Fatalf("unexpected indexed metadata: %+v", file)
	}
}

func TestFileServiceListDriversFiltersByESXiVersion(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)
	files := []models.FileMetadata{
		{StorageBucketID: bucketID, Path: "drivers/8.0/network/net.vib", Type: models.FileTypeDriver, ESXiVersion: "8.0", DriverCategory: "network"},
		{StorageBucketID: bucketID, Path: "drivers/7.0/network/net.vib", Type: models.FileTypeDriver, ESXiVersion: "7.0", DriverCategory: "network"},
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatalf("create driver metadata: %v", err)
	}

	service := NewFileService(db, nil)
	got, err := service.ListDrivers(context.Background(), bucketID, "8.0", "network")
	if err != nil {
		t.Fatalf("list filtered drivers: %v", err)
	}
	if len(got) != 1 || got[0].ESXiVersion != "8.0" || got[0].Path != "drivers/8.0/network/net.vib" {
		t.Fatalf("unexpected filtered drivers: %+v", got)
	}
}
