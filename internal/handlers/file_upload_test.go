package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/esxi-builder/esxi-iso-builder/internal/database"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/services"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

func TestUploadReturnsStoredButUnconfirmedOutcome(t *testing.T) {
	db, err := database.InitDB(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	defer pool.Close()
	bucket := models.StorageBucket{Name: "Local", Type: models.StorageTypeLocal, LocalPath: t.TempDir()}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Create().Before("gorm:create").Register("metadata_failure", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Dest.(*models.FileMetadata); ok {
			tx.AddError(errors.New("injected failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Post("/upload", NewFileHandler(services.NewFileService(db, nil)).UploadFile)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("bucket_id", "1"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("type", "depot"); err != nil {
		t.Fatal(err)
	}
	file, err := writer.CreateFormFile("file", "test.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("payload")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/upload", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
		Data    struct {
			Stored    bool                `json:"stored"`
			Confirmed bool                `json:"metadata_confirmed"`
			File      models.FileMetadata `json:"file"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 409 || result.Success || result.Code != "upload_stored_metadata_pending" || !result.Data.Stored || result.Data.Confirmed || result.Data.File.Path != "depots/test.zip" || result.Data.File.SHA256 == "" {
		t.Fatalf("unexpected upload outcome: status=%d body=%+v", response.StatusCode, result)
	}
}
