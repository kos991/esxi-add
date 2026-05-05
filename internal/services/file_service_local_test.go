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

func TestFileServiceUploadDepotUsesSelectedESXiVersionPath(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)
	service := NewFileService(db, nil)

	metadata, err := service.UploadFile(context.Background(), bucketID, models.FileTypeDepot, "6.5", "", "ESXi650-202210001.zip", strings.NewReader("depot"), int64(len("depot")))
	if err != nil {
		t.Fatalf("upload versioned depot: %v", err)
	}

	if metadata.Path != "depots/6.5/ESXi650-202210001.zip" {
		t.Fatalf("expected versioned depot path, got %s", metadata.Path)
	}
	if metadata.ESXiVersion != "6.5" || metadata.DriverName != "ESXi650-202210001" || metadata.DriverVersion != "ESXi650-202210001" {
		t.Fatalf("unexpected depot metadata: %+v", metadata)
	}
	if _, err := os.Stat(filepath.Join(root, "depots", "6.5", "ESXi650-202210001.zip")); err != nil {
		t.Fatalf("uploaded versioned depot missing: %v", err)
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

func TestFileServiceRefreshCacheExtractsDepotAndDriverDisplayMetadata(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)

	files := map[string]string{
		filepath.Join("depot", "6x", "ESXi650-202210001.zip"):                   "depot-65",
		filepath.Join("depot", "6x", "ESXi670-202210001.zip"):                   "depot-67",
		filepath.Join("driver", "6x", "net-igb-5.3.2-99-offline_bundle.zip"):    "driver",
		filepath.Join("driver", "6x", "scsi-megaraid-sas-6.714.07.00-1OEM.vib"): "storage-driver",
		filepath.Join("driver", "6x", "raid-example-1.2.3-offline_bundle.zip"):  "raid-driver",
		filepath.Join("driver", "6x", "misc-tool-1.0.0-offline_bundle.zip"):     "other-driver",
	}
	for name, body := range files {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", name, err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	service := NewFileService(db, nil)
	if err := service.RefreshCache(context.Background(), bucketID); err != nil {
		t.Fatalf("refresh local cache: %v", err)
	}

	var depot65 models.FileMetadata
	if err := db.Where("storage_bucket_id = ? AND path = ?", bucketID, "depot/6x/ESXi650-202210001.zip").First(&depot65).Error; err != nil {
		t.Fatalf("find depot 6.5: %v", err)
	}
	if depot65.ESXiVersion != "6.5" || depot65.DriverName != "ESXi650-202210001" || depot65.DriverVersion != "ESXi650-202210001" {
		t.Fatalf("unexpected depot 6.5 metadata: %+v", depot65)
	}

	var driver models.FileMetadata
	if err := db.Where("storage_bucket_id = ? AND path = ?", bucketID, "driver/6x/net-igb-5.3.2-99-offline_bundle.zip").First(&driver).Error; err != nil {
		t.Fatalf("find network driver: %v", err)
	}
	if driver.DriverCategory != "network" || driver.DriverName != "net-igb-5.3.2-99-offline_bundle" || driver.DriverVersion != "net-igb-5.3.2-99" || driver.DriverDescription == "" {
		t.Fatalf("unexpected driver metadata: %+v", driver)
	}

	depots65, err := service.ListDepots(context.Background(), bucketID, "6.5")
	if err != nil {
		t.Fatalf("list depots 6.5: %v", err)
	}
	if len(depots65) != 1 || depots65[0].Path != "depot/6x/ESXi650-202210001.zip" {
		t.Fatalf("expected only 6.5 depot, got %+v", depots65)
	}

	depots67, err := service.ListDepots(context.Background(), bucketID, "6.7")
	if err != nil {
		t.Fatalf("list depots 6.7: %v", err)
	}
	if len(depots67) != 1 || depots67[0].Path != "depot/6x/ESXi670-202210001.zip" {
		t.Fatalf("expected only 6.7 depot, got %+v", depots67)
	}

	for objectPath, category := range map[string]string{
		"driver/6x/scsi-megaraid-sas-6.714.07.00-1OEM.vib": "storage",
		"driver/6x/raid-example-1.2.3-offline_bundle.zip":  "raid",
		"driver/6x/misc-tool-1.0.0-offline_bundle.zip":     "other",
	} {
		var file models.FileMetadata
		if err := db.Where("storage_bucket_id = ? AND path = ?", bucketID, objectPath).First(&file).Error; err != nil {
			t.Fatalf("find driver %s: %v", objectPath, err)
		}
		if file.DriverCategory != category {
			t.Fatalf("expected category %s for %s, got %+v", category, objectPath, file)
		}
	}
}

func TestFileServiceRenameLocalFileUpdatesObjectAndMetadata(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)
	service := NewFileService(db, nil)

	metadata, err := service.UploadFile(context.Background(), bucketID, models.FileTypeDriver, "8.0", "network", "net-r8125-9.011.00.vib", strings.NewReader("driver"), int64(len("driver")))
	if err != nil {
		t.Fatalf("upload driver: %v", err)
	}

	renamed, err := service.RenameFile(context.Background(), metadata.ID, "net-r8125-9.012.00.vib")
	if err != nil {
		t.Fatalf("rename local file: %v", err)
	}

	if renamed.Path != "drivers/8.0/network/net-r8125-9.012.00.vib" || renamed.DriverName != "net-r8125-9.012.00" || renamed.DriverVersion != "net-r8125-9.012.00" {
		t.Fatalf("unexpected renamed metadata: %+v", renamed)
	}
	if _, err := os.Stat(filepath.Join(root, "drivers", "8.0", "network", "net-r8125-9.011.00.vib")); !os.IsNotExist(err) {
		t.Fatalf("expected old local object removed, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "drivers", "8.0", "network", "net-r8125-9.012.00.vib")); err != nil {
		t.Fatalf("expected renamed local object: %v", err)
	}
}

func TestFileServiceRefreshCacheIndexesDepotAndDriverDirectoryAliases(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)

	files := map[string]string{
		filepath.Join("depot", "8.0", "ESXi-8.0.zip"):                  "depot-8",
		filepath.Join("depots", "7.0", "ESXi-7.0.zip"):                 "depot-7",
		filepath.Join("driver", "8.0", "network", "net.vib"):           "driver-8",
		filepath.Join("drivers", "7.0", "storage", "storage.vib"):      "driver-7",
		filepath.Join("driver", "8.0", "images", "custom-esxi.iso"):    "iso-from-driver",
		filepath.Join("iso", "8.0", "installer.iso"):                   "iso-dir",
		filepath.Join("isos", "7.0", "legacy-installer.iso"):           "isos-dir",
		filepath.Join("output", "builds", "generated-custom-esxi.iso"): "output-dir",
	}
	for name, body := range files {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", name, err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	service := NewFileService(db, nil)
	if err := service.RefreshCache(context.Background(), bucketID); err != nil {
		t.Fatalf("refresh local cache: %v", err)
	}

	assertFileMetadata(t, db, bucketID, "depot/8.0/ESXi-8.0.zip", models.FileTypeDepot, "8.0", "")
	assertFileMetadata(t, db, bucketID, "depots/7.0/ESXi-7.0.zip", models.FileTypeDepot, "7.0", "")
	assertFileMetadata(t, db, bucketID, "driver/8.0/network/net.vib", models.FileTypeDriver, "8.0", "network")
	assertFileMetadata(t, db, bucketID, "drivers/7.0/storage/storage.vib", models.FileTypeDriver, "7.0", "storage")
	assertFileMetadata(t, db, bucketID, "driver/8.0/images/custom-esxi.iso", models.FileTypeISO, "8.0", "")
	assertFileMetadata(t, db, bucketID, "iso/8.0/installer.iso", models.FileTypeISO, "8.0", "")
	assertFileMetadata(t, db, bucketID, "isos/7.0/legacy-installer.iso", models.FileTypeISO, "7.0", "")
	assertFileMetadata(t, db, bucketID, "output/builds/generated-custom-esxi.iso", models.FileTypeISO, "", "")
}

func TestFileServiceRefreshCacheIndexesFlatVersionDriverDirectories(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)

	files := map[string]string{
		filepath.Join("depot", "8x", "VMware-ESXi-8x.zip"):         "depot",
		filepath.Join("depot", "8x", ".openlist"):                  "marker",
		filepath.Join("driver", "8x", "net-r8125-9.011.00.vib"):    "network-driver",
		filepath.Join("driver", "8x", "custom-esxi-installer.iso"): "iso",
		filepath.Join("driver", "8x", ".openlist"):                 "marker",
	}
	for name, body := range files {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", name, err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	staleMarkers := []models.FileMetadata{
		{StorageBucketID: bucketID, Path: "depot/8x/.openlist", Type: models.FileTypeDepot, ESXiVersion: "8x"},
		{StorageBucketID: bucketID, Path: "driver/8x/.openlist", Type: models.FileTypeDriver, ESXiVersion: "8x", DriverCategory: ".openlist"},
	}
	if err := db.Create(&staleMarkers).Error; err != nil {
		t.Fatalf("create stale marker metadata: %v", err)
	}

	service := NewFileService(db, nil)
	if err := service.RefreshCache(context.Background(), bucketID); err != nil {
		t.Fatalf("refresh local cache: %v", err)
	}

	assertFileMetadata(t, db, bucketID, "depot/8x/VMware-ESXi-8x.zip", models.FileTypeDepot, "8x", "")
	assertFileMetadata(t, db, bucketID, "driver/8x/net-r8125-9.011.00.vib", models.FileTypeDriver, "8x", "network")
	assertFileMetadata(t, db, bucketID, "driver/8x/custom-esxi-installer.iso", models.FileTypeISO, "8x", "")

	var markerCount int64
	if err := db.Model(&models.FileMetadata{}).
		Where("storage_bucket_id = ? AND path LIKE ?", bucketID, "%.openlist").
		Count(&markerCount).Error; err != nil {
		t.Fatalf("count marker metadata: %v", err)
	}
	if markerCount != 0 {
		t.Fatalf("expected .openlist marker files to be ignored, got %d metadata rows", markerCount)
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

func TestFileServiceListDriversAcceptsESXiVersionAliases(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)
	files := []models.FileMetadata{
		{StorageBucketID: bucketID, Path: "driver/6x/net-r8168.vib", Type: models.FileTypeDriver, ESXiVersion: "6x", DriverCategory: "network"},
		{StorageBucketID: bucketID, Path: "drivers/6.5/network/net-e1000.vib", Type: models.FileTypeDriver, ESXiVersion: "6.5", DriverCategory: "network"},
		{StorageBucketID: bucketID, Path: "driver/8x/net-r8125.vib", Type: models.FileTypeDriver, ESXiVersion: "8x", DriverCategory: "network"},
		{StorageBucketID: bucketID, Path: "driver/7x/net-r8168.vib", Type: models.FileTypeDriver, ESXiVersion: "7x", DriverCategory: "network"},
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatalf("create driver metadata: %v", err)
	}

	service := NewFileService(db, nil)
	for _, version := range []string{"8.0", "8.x"} {
		got, err := service.ListDrivers(context.Background(), bucketID, version, "network")
		if err != nil {
			t.Fatalf("list filtered drivers for %s: %v", version, err)
		}
		if len(got) != 1 || got[0].ESXiVersion != "8x" || got[0].Path != "driver/8x/net-r8125.vib" {
			t.Fatalf("unexpected filtered drivers for %s: %+v", version, got)
		}
	}
	for version, wantCount := range map[string]int{"6.5": 2, "6.7": 1} {
		got, err := service.ListDrivers(context.Background(), bucketID, version, "network")
		if err != nil {
			t.Fatalf("list filtered drivers for %s: %v", version, err)
		}
		if len(got) != wantCount || got[0].ESXiVersion != "6x" || got[0].Path != "driver/6x/net-r8168.vib" {
			t.Fatalf("unexpected filtered drivers for %s: %+v", version, got)
		}
	}
	got, err := service.ListDrivers(context.Background(), bucketID, "6.x", "network")
	if err != nil {
		t.Fatalf("list filtered drivers for 6.x: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 6.x to include 6x and 6.5 drivers, got %+v", got)
	}
}

func assertFileMetadata(t *testing.T, db *gorm.DB, bucketID uint, objectPath, fileType, esxiVersion, driverCategory string) {
	t.Helper()

	var file models.FileMetadata
	if err := db.Where("storage_bucket_id = ? AND path = ?", bucketID, objectPath).First(&file).Error; err != nil {
		t.Fatalf("find indexed file %s: %v", objectPath, err)
	}
	if file.Type != fileType || file.ESXiVersion != esxiVersion || file.DriverCategory != driverCategory {
		t.Fatalf("unexpected metadata for %s: %+v", objectPath, file)
	}
}
