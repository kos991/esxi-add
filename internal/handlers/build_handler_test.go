package handlers

import (
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
	app.Post("/builds", NewBuildHandler(db, client).Create)

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
