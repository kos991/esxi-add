package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/gofiber/fiber/v2"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
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
