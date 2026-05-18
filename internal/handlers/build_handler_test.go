package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/gofiber/fiber/v2"
	"github.com/hibiken/asynq"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
)

func TestCreateBuildRejectsMissingRequiredFields(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.BuildTask{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	app := fiber.New()
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "127.0.0.1:0"})
	defer client.Close()
	app.Post("/builds", NewBuildHandler(db, client, "local").Create)

	req := httptest.NewRequest(http.MethodPost, "/builds", strings.NewReader(`{"bucket_id":1,"driver_paths":[]}`))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", resp.StatusCode)
	}

	var count int64
	if err := db.Model(&models.BuildTask{}).Count(&count).Error; err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no build task to be created, got %d", count)
	}
}

func TestCreateBuildExternalModeDoesNotRequireQueue(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.BuildTask{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	app := fiber.New()
	app.Post("/builds", NewBuildHandler(db, nil, "external").Create)

	req := httptest.NewRequest(http.MethodPost, "/builds", strings.NewReader(`{"bucket_id":2,"esxi_version":"6.5","depot_path":"depot/6x/ESXi650.zip","driver_paths":["driver/6x/net.vib"],"custom_iso_name":"custom.iso"}`))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("expected status 201, got %d", resp.StatusCode)
	}

	var response struct {
		Success bool             `json:"success"`
		Data    models.BuildTask `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Success || response.Data.Status != models.BuildTaskStatusPending {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestDeleteBuildAcceptsNumericID(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.BuildTask{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	task := models.BuildTask{
		TaskID:      "task-123",
		Status:      models.BuildTaskStatusFailed,
		ESXiVersion: "6.7",
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	app := fiber.New()
	app.Delete("/builds/:id", NewBuildHandler(db, nil, "external").Delete)

	req := httptest.NewRequest(http.MethodDelete, "/builds/1", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	var count int64
	if err := db.Model(&models.BuildTask{}).Count(&count).Error; err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected build task to be deleted, got %d", count)
	}
}

func TestDownloadBuildArtifactServesCompletedLocalISO(t *testing.T) {
	localRoot := t.TempDir()
	db, bucketID := newBuildHandlerLocalBucketTestDB(t, localRoot)
	if err := db.AutoMigrate(&models.BuildTask{}); err != nil {
		t.Fatalf("migrate build tasks: %v", err)
	}

	objectPath := "output/custom.iso"
	writeBuildHandlerLocalObject(t, localRoot, objectPath, []byte("iso-content"))
	task := models.BuildTask{
		TaskID:          "task-download",
		Status:          models.BuildTaskStatusCompleted,
		StorageBucketID: bucketID,
		OutputISO:       objectPath,
		OutputISOSize:   int64(len("iso-content")),
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	app := fiber.New()
	app.Get("/builds/:id/artifact", NewBuildHandler(db, nil, "external").DownloadArtifact)

	req := httptest.NewRequest(http.MethodGet, "/builds/task-download/artifact", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("download request: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(body) != "iso-content" {
		t.Fatalf("unexpected artifact body %q", body)
	}
	if disposition := resp.Header.Get("Content-Disposition"); !strings.Contains(disposition, `filename="custom.iso"`) {
		t.Fatalf("expected attachment filename, got %q", disposition)
	}
	if contentType := resp.Header.Get("Content-Type"); !strings.Contains(contentType, "application/x-iso9660-image") {
		t.Fatalf("expected ISO content type, got %q", contentType)
	}
}

func TestDownloadBuildArtifactRejectsIncompleteTask(t *testing.T) {
	localRoot := t.TempDir()
	db, bucketID := newBuildHandlerLocalBucketTestDB(t, localRoot)
	if err := db.AutoMigrate(&models.BuildTask{}); err != nil {
		t.Fatalf("migrate build tasks: %v", err)
	}

	task := models.BuildTask{
		TaskID:          "task-running",
		Status:          models.BuildTaskStatusRunning,
		StorageBucketID: bucketID,
		OutputISO:       "output/custom.iso",
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	app := fiber.New()
	app.Get("/builds/:id/artifact", NewBuildHandler(db, nil, "external").DownloadArtifact)

	req := httptest.NewRequest(http.MethodGet, "/builds/task-running/artifact", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("download request: %v", err)
	}
	if resp.StatusCode != fiber.StatusConflict {
		t.Fatalf("expected status 409, got %d", resp.StatusCode)
	}
}

func TestBuildPreflightLocalFilesReportsReadyAndInvalidInputs(t *testing.T) {
	localRoot := t.TempDir()
	buildWorkDir := t.TempDir()
	db, bucketID := newBuildHandlerLocalBucketTestDB(t, localRoot)

	validDepot := "depot/8x/ESXi-8.0.zip"
	invalidDriver := "driver/8x/net-r8125.zip"
	writeBuildHandlerLocalObject(t, localRoot, validDepot, []byte("PK\x03\x04depot"))
	writeBuildHandlerLocalObject(t, localRoot, invalidDriver, []byte("\n<!DOCTYPE html>"))
	if err := db.Create(&[]models.FileMetadata{
		{StorageBucketID: bucketID, Path: validDepot, Type: models.FileTypeDepot, ESXiVersion: "8.0"},
		{StorageBucketID: bucketID, Path: invalidDriver, Type: models.FileTypeDriver, ESXiVersion: "8.0", DriverCategory: "network"},
	}).Error; err != nil {
		t.Fatalf("create file metadata: %v", err)
	}

	app := fiber.New()
	handler := NewBuildHandler(db, nil, "external")
	handler.SetWorkDir(buildWorkDir)
	app.Post("/builds/preflight", handler.StartPreflight)
	app.Get("/builds/preflight/:id", handler.GetPreflight)

	body := `{"bucket_id":` + strconv.FormatUint(uint64(bucketID), 10) + `,"depot_path":"` + validDepot + `","driver_paths":["` + invalidDriver + `"]}`
	req := httptest.NewRequest(http.MethodPost, "/builds/preflight", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("start preflight request: %v", err)
	}
	if resp.StatusCode != fiber.StatusAccepted {
		t.Fatalf("expected status 202, got %d", resp.StatusCode)
	}

	var started struct {
		Success bool           `json:"success"`
		Data    BuildPreflight `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}
	if !started.Success || started.Data.ID == "" {
		t.Fatalf("unexpected start response: %+v", started)
	}

	status := waitForBuildPreflightStatus(t, app, started.Data.ID)
	if status.Data.Status != PreflightStatusInvalid || status.Data.Progress != 100 {
		t.Fatalf("expected invalid completed preflight, got %+v", status.Data)
	}
	if len(status.Data.Files) != 2 {
		t.Fatalf("expected two preflight files, got %+v", status.Data.Files)
	}
	if status.Data.Files[0].Status != PreflightFileStatusReady || !status.Data.Files[0].Cached {
		t.Fatalf("expected depot ready, got %+v", status.Data.Files[0])
	}
	if status.Data.Files[1].Status != PreflightFileStatusInvalid || status.Data.Files[1].Message == "" {
		t.Fatalf("expected driver invalid with message, got %+v", status.Data.Files[1])
	}
}

func TestBuildPreflightS3FilesDownloadsMissingCacheBeforeValidation(t *testing.T) {
	buildWorkDir := t.TempDir()
	db, bucketID := newBuildHandlerS3BucketTestDB(t)
	depotPath := "depot/8x/ESXi-8.0.zip"
	driverPath := "driver/8x/net-r8125.vib"
	if err := db.Create(&[]models.FileMetadata{
		{StorageBucketID: bucketID, Path: depotPath, Type: models.FileTypeDepot, ESXiVersion: "8.0", ETag: "depot-etag", Size: 9},
		{StorageBucketID: bucketID, Path: driverPath, Type: models.FileTypeDriver, ESXiVersion: "8.0", DriverCategory: "network", ETag: "driver-etag", Size: 13},
	}).Error; err != nil {
		t.Fatalf("create file metadata: %v", err)
	}

	previousFactory := newPreflightS3Client
	t.Cleanup(func() { newPreflightS3Client = previousFactory })
	downloads := 0
	newPreflightS3Client = func(cfg *storage.S3Config) (preflightS3Client, error) {
		return fakePreflightS3Client{
			infoByPath: map[string]minio.ObjectInfo{
				depotPath:  {Key: depotPath, ETag: "depot-etag", Size: 9},
				driverPath: {Key: driverPath, ETag: "driver-etag", Size: 13},
			},
			bodyByPath: map[string]string{
				depotPath:  "PK\x03\x04depot",
				driverPath: "!<arch>\nbody",
			},
			onDownload: func() { downloads++ },
		}, nil
	}

	app := fiber.New()
	handler := NewBuildHandler(db, nil, "external")
	handler.SetWorkDir(buildWorkDir)
	app.Post("/builds/preflight", handler.StartPreflight)
	app.Get("/builds/preflight/:id", handler.GetPreflight)

	body := `{"bucket_id":` + strconv.FormatUint(uint64(bucketID), 10) + `,"depot_path":"` + depotPath + `","driver_paths":["` + driverPath + `"]}`
	req := httptest.NewRequest(http.MethodPost, "/builds/preflight", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("start preflight request: %v", err)
	}
	if resp.StatusCode != fiber.StatusAccepted {
		t.Fatalf("expected status 202, got %d", resp.StatusCode)
	}
	var started struct {
		Success bool           `json:"success"`
		Data    BuildPreflight `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&started); err != nil {
		t.Fatalf("decode start response: %v", err)
	}

	status := waitForBuildPreflightStatus(t, app, started.Data.ID)
	if status.Data.Status != PreflightStatusReady || status.Data.Progress != 100 {
		t.Fatalf("expected ready preflight, got %+v", status.Data)
	}
	if downloads != 2 {
		t.Fatalf("expected depot and driver downloads, got %d", downloads)
	}
	for _, objectPath := range []string{depotPath, driverPath} {
		if _, err := os.Stat(filepath.Join(buildWorkDir, "cache", "bucket-"+strconv.FormatUint(uint64(bucketID), 10), filepath.FromSlash(objectPath))); err != nil {
			t.Fatalf("expected cached object %s: %v", objectPath, err)
		}
	}
}

func TestBuildPreflightRejectsWhenTooManyAreRunning(t *testing.T) {
	localRoot := t.TempDir()
	db, bucketID := newBuildHandlerLocalBucketTestDB(t, localRoot)

	validDepot := "depot/8x/ESXi-8.0.zip"
	writeBuildHandlerLocalObject(t, localRoot, validDepot, []byte("PK\x03\x04depot"))
	if err := db.Create(&models.FileMetadata{
		StorageBucketID: bucketID,
		Path:            validDepot,
		Type:            models.FileTypeDepot,
		ESXiVersion:     "8.0",
	}).Error; err != nil {
		t.Fatalf("create file metadata: %v", err)
	}

	app := fiber.New()
	handler := NewBuildHandler(db, nil, "external")
	handler.preflights["running"] = &BuildPreflight{
		ID:        "running",
		Status:    PreflightStatusRunning,
		Files:     []PreflightFile{{Kind: "depot", Path: validDepot, Status: PreflightFileStatusDownloading}},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	app.Post("/builds/preflight", handler.StartPreflight)

	body := `{"bucket_id":` + strconv.FormatUint(uint64(bucketID), 10) + `,"depot_path":"` + validDepot + `","driver_paths":[]}`
	req := httptest.NewRequest(http.MethodPost, "/builds/preflight", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("start preflight request: %v", err)
	}
	if resp.StatusCode != fiber.StatusTooManyRequests {
		t.Fatalf("expected status 429, got %d", resp.StatusCode)
	}
}

func TestBuildPreflightResolverNormalizesStorageType(t *testing.T) {
	localRoot := t.TempDir()
	db, bucketID := newBuildHandlerLocalBucketTestDB(t, localRoot)
	if err := db.Model(&models.StorageBucket{}).Where("id = ?", bucketID).Update("type", "LOCAL").Error; err != nil {
		t.Fatalf("update bucket type: %v", err)
	}

	handler := NewBuildHandler(db, nil, "external")
	resolver, err := handler.preflightResolver(context.Background(), bucketID)
	if err != nil {
		t.Fatalf("expected normalized local bucket to resolve, got %v", err)
	}

	objectPath := "depot/8x/ESXi-8.0.zip"
	writeBuildHandlerLocalObject(t, localRoot, objectPath, []byte("PK\x03\x04depot"))
	localPath, err := resolver.EnsureFile(context.Background(), objectPath, nil)
	if err != nil {
		t.Fatalf("ensure local object: %v", err)
	}
	if !strings.HasSuffix(filepath.ToSlash(localPath), objectPath) {
		t.Fatalf("expected local object path to end with %q, got %q", objectPath, localPath)
	}
}

func waitForBuildPreflightStatus(t *testing.T, app *fiber.App, id string) struct {
	Success bool           `json:"success"`
	Data    BuildPreflight `json:"data"`
} {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var status struct {
		Success bool           `json:"success"`
		Data    BuildPreflight `json:"data"`
	}
	for time.Now().Before(deadline) {
		statusReq := httptest.NewRequest(http.MethodGet, "/builds/preflight/"+id, nil)
		statusResp, err := app.Test(statusReq)
		if err != nil {
			t.Fatalf("get preflight request: %v", err)
		}
		if statusResp.StatusCode != fiber.StatusOK {
			t.Fatalf("expected status 200, got %d", statusResp.StatusCode)
		}
		if err := json.NewDecoder(statusResp.Body).Decode(&status); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		switch status.Data.Status {
		case PreflightStatusReady, PreflightStatusInvalid, PreflightStatusFailed:
			return status
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("preflight %s did not finish, last status %+v", id, status.Data)
	return status
}

func newBuildHandlerLocalBucketTestDB(t *testing.T, localRoot string) (*gorm.DB, uint) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}, &models.FileMetadata{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	bucket := models.StorageBucket{Name: "Local", Type: models.StorageTypeLocal, LocalPath: localRoot, IsDefault: true}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatalf("create bucket: %v", err)
	}
	return db, bucket.ID
}

func newBuildHandlerS3BucketTestDB(t *testing.T) (*gorm.DB, uint) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}, &models.FileMetadata{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	bucket := models.StorageBucket{Name: "R2", Type: models.StorageTypeS3, Endpoint: "r2.example", BucketName: "esxi-build", Region: "auto"}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatalf("create bucket: %v", err)
	}
	return db, bucket.ID
}

type fakePreflightS3Client struct {
	infoByPath map[string]minio.ObjectInfo
	bodyByPath map[string]string
	onDownload func()
}

func (f fakePreflightS3Client) GetObjectInfo(ctx context.Context, objectPath string) (minio.ObjectInfo, error) {
	if info, ok := f.infoByPath[objectPath]; ok {
		return info, nil
	}
	return minio.ObjectInfo{}, os.ErrNotExist
}

func (f fakePreflightS3Client) Download(ctx context.Context, objectPath string) (io.ReadCloser, error) {
	if f.onDownload != nil {
		f.onDownload()
	}
	body, ok := f.bodyByPath[objectPath]
	if !ok {
		return nil, os.ErrNotExist
	}
	return io.NopCloser(strings.NewReader(body)), nil
}

func writeBuildHandlerLocalObject(t *testing.T, root, objectPath string, content []byte) {
	t.Helper()
	localPath := filepath.Join(root, filepath.FromSlash(objectPath))
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		t.Fatalf("mkdir object path: %v", err)
	}
	if err := os.WriteFile(localPath, content, 0o644); err != nil {
		t.Fatalf("write local object: %v", err)
	}
}
