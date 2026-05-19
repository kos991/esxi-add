package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func TestWorkerClaimDownloadAndUploadArtifactForLocalBucket(t *testing.T) {
	root := t.TempDir()
	depotPath := filepath.Join(root, "depot", "6x", "ESXi650.zip")
	if err := os.MkdirAll(filepath.Dir(depotPath), 0o755); err != nil {
		t.Fatalf("mkdir depot: %v", err)
	}
	if err := os.WriteFile(depotPath, []byte("depot-data"), 0o644); err != nil {
		t.Fatalf("write depot: %v", err)
	}

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}, &models.BuildTask{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	bucket := models.StorageBucket{Name: "Local", Type: models.StorageTypeLocal, LocalPath: root}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatalf("create bucket: %v", err)
	}
	task := models.BuildTask{
		TaskID:          "task-1",
		Status:          models.BuildTaskStatusPending,
		StorageBucketID: bucket.ID,
		ESXiVersion:     "6.5",
		DepotPath:       "depot/6x/ESXi650.zip",
		Drivers:         `["driver/6x/net.vib"]`,
		CustomISOName:   "custom.iso",
		ImageProfile:    "ESXi-6.5.0-standard",
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatalf("create task: %v", err)
	}

	app := fiber.New()
	worker := NewWorkerHandler(db, "secret")
	app.Post("/worker/builds/claim", worker.ClaimBuild)
	app.Get("/worker/files", worker.DownloadFile)
	app.Post("/worker/builds/:id/artifact", worker.UploadArtifact)

	claimReq := httptest.NewRequest(http.MethodPost, "/worker/builds/claim", nil)
	claimReq.Header.Set("X-Worker-Token", "secret")
	claimResp, err := app.Test(claimReq)
	if err != nil {
		t.Fatalf("claim request: %v", err)
	}
	if claimResp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected claim status 200, got %d", claimResp.StatusCode)
	}
	var claim struct {
		Success bool `json:"success"`
		Data    struct {
			TaskID        string   `json:"task_id"`
			BucketID      uint     `json:"bucket_id"`
			DepotPath     string   `json:"depot_path"`
			DriverPaths   []string `json:"driver_paths"`
			ImageProfile  string   `json:"image_profile"`
			OutputISOName string   `json:"output_iso_name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(claimResp.Body).Decode(&claim); err != nil {
		t.Fatalf("decode claim: %v", err)
	}
	if !claim.Success ||
		claim.Data.TaskID != "task-1" ||
		claim.Data.BucketID != bucket.ID ||
		claim.Data.DepotPath != "depot/6x/ESXi650.zip" ||
		len(claim.Data.DriverPaths) != 1 ||
		claim.Data.ImageProfile != "ESXi-6.5.0-standard" ||
		claim.Data.OutputISOName != "custom.iso" {
		t.Fatalf("unexpected claim: %+v", claim)
	}

	downloadReq := httptest.NewRequest(http.MethodGet, "/worker/files?bucket_id=1&path=depot/6x/ESXi650.zip", nil)
	downloadReq.Header.Set("X-Worker-Token", "secret")
	downloadResp, err := app.Test(downloadReq)
	if err != nil {
		t.Fatalf("download request: %v", err)
	}
	if downloadResp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected download status 200, got %d", downloadResp.StatusCode)
	}
	body, err := io.ReadAll(downloadResp.Body)
	if err != nil {
		t.Fatalf("read download: %v", err)
	}
	if string(body) != "depot-data" {
		t.Fatalf("unexpected download body: %q", body)
	}

	var uploadBody bytes.Buffer
	writer := multipart.NewWriter(&uploadBody)
	part, err := writer.CreateFormFile("file", "custom.iso")
	if err != nil {
		t.Fatalf("create multipart file: %v", err)
	}
	if _, err := part.Write([]byte("iso-data")); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	uploadReq := httptest.NewRequest(http.MethodPost, "/worker/builds/task-1/artifact", &uploadBody)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadReq.Header.Set("X-Worker-Token", "secret")
	uploadResp, err := app.Test(uploadReq)
	if err != nil {
		t.Fatalf("upload request: %v", err)
	}
	if uploadResp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected upload status 200, got %d", uploadResp.StatusCode)
	}

	var updated models.BuildTask
	if err := db.Where("task_id = ?", "task-1").First(&updated).Error; err != nil {
		t.Fatalf("find updated task: %v", err)
	}
	if updated.Status != models.BuildTaskStatusCompleted ||
		updated.Progress != 100 ||
		updated.OutputISO != "output/custom.iso" ||
		updated.OutputISOSize != int64(len("iso-data")) ||
		updated.OutputISOSHA256 == "" {
		t.Fatalf("unexpected updated task: %+v", updated)
	}
	artifact, err := os.ReadFile(filepath.Join(root, "output", "custom.iso"))
	if err != nil {
		t.Fatalf("read artifact: %v", err)
	}
	if strings.TrimSpace(string(artifact)) != "iso-data" {
		t.Fatalf("unexpected artifact content: %q", artifact)
	}
}

func TestWorkerTokenIsRequired(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.BuildTask{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	app := fiber.New()
	app.Post("/worker/builds/claim", NewWorkerHandler(db, "").ClaimBuild)

	req := httptest.NewRequest(http.MethodPost, "/worker/builds/claim", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("claim request: %v", err)
	}
	if resp.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("expected worker API to be unavailable without token, got %d", resp.StatusCode)
	}
}
