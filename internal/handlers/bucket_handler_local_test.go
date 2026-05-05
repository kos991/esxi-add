package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func TestCreateLocalBucket(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	app := fiber.New()
	app.Post("/buckets", NewBucketHandler(db).Create)

	body := `{"name":"Local","type":"local","local_path":"` + strings.ReplaceAll(t.TempDir(), `\`, `\\`) + `","is_default":true}`
	req := httptest.NewRequest(http.MethodPost, "/buckets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("expected status 201, got %d", resp.StatusCode)
	}

	var response struct {
		Success bool                 `json:"success"`
		Data    models.StorageBucket `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Success || response.Data.Type != models.StorageTypeLocal || response.Data.LocalPath == "" || !response.Data.IsDefault {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestUpdateLocalBucketMountPath(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	bucket := models.StorageBucket{
		Name:      "Local",
		Type:      models.StorageTypeLocal,
		LocalPath: t.TempDir(),
		IsDefault: true,
	}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatalf("create bucket: %v", err)
	}

	app := fiber.New()
	app.Put("/buckets/:id", NewBucketHandler(db).Update)

	nextPath := t.TempDir()
	body := `{"name":"Local","type":"local","local_path":` + jsonQuote(t, nextPath) + `,"is_default":true}`
	req := httptest.NewRequest(http.MethodPut, "/buckets/1", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	var response struct {
		Success bool                 `json:"success"`
		Data    models.StorageBucket `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Success || response.Data.Type != models.StorageTypeLocal || response.Data.LocalPath != nextPath || !response.Data.IsDefault {
		t.Fatalf("unexpected response: %+v", response)
	}

	var updated models.StorageBucket
	if err := db.First(&updated, bucket.ID).Error; err != nil {
		t.Fatalf("find updated bucket: %v", err)
	}
	if updated.LocalPath != nextPath {
		t.Fatalf("local path was not updated: %q", updated.LocalPath)
	}
}

func jsonQuote(t *testing.T, value string) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json quote: %v", err)
	}
	return string(raw)
}
