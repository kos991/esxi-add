package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/esxi-builder/esxi-iso-builder/internal/middleware"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/services"
	"github.com/glebarez/sqlite"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

func regressionDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}, &models.FileMetadata{}, &models.BuildTask{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestConfigReusesOnlySelectedSecretAndDoesNotEchoIt(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			t.Errorf("mutation: %s", r.Method)
			w.WriteHeader(500)
			return
		}
		if !strings.Contains(r.Header.Get("Authorization"), "Credential=fake-access/") {
			t.Error("missing access credential")
		}
		if r.Method == "GET" {
			_, _ = io.WriteString(w, `<ListBucketResult><Name>test-bucket</Name><IsTruncated>false</IsTruncated></ListBucketResult>`)
		}
	}))
	defer server.Close()
	db := regressionDB(t)
	bucket := models.StorageBucket{Name: "test", Type: "s3", Endpoint: server.URL, AccessKey: "fake-access", SecretKey: "fake-secret", BucketName: "test-bucket", Region: "us-east-1"}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Post("/test", NewBucketHandler(db).TestConfig)
	for _, id := range []uint{bucket.ID, 999, 0} {
		request := bucketRequest{ID: &id, Name: "test", Type: "s3", Endpoint: server.URL, AccessKey: "fake-access", BucketName: "test-bucket", Region: "us-east-1"}
		body, _ := json.Marshal(request)
		req := httptest.NewRequest("POST", "/test", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		res, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if id == bucket.ID {
			if res.StatusCode != 200 {
				t.Fatalf("%d %s", res.StatusCode, data)
			}
			if !strings.Contains(string(data), `"write":"untested"`) {
				t.Fatal(string(data))
			}
		} else if res.StatusCode == 200 {
			t.Fatal("invalid id accepted")
		}
		if strings.Contains(string(data), "fake-secret") || strings.Contains(string(data), "fake-access") {
			t.Fatal("credential leaked")
		}
	}
	req := bucketRequest{Type: "s3"}
	mergeBucketUpdateRequest(&req, bucket)
	if req.SecretKey != "fake-secret" {
		t.Fatal("blank secret was not reused")
	}
}

func TestDeleteNodeProtectsDefaultAndTaskReferences(t *testing.T) {
	db := regressionDB(t)
	app := fiber.New()
	app.Delete("/buckets/:id", NewBucketHandler(db).Delete)
	for _, kind := range []string{"default", "referenced", "unused"} {
		bucket := models.StorageBucket{Name: kind, Type: "local", LocalPath: t.TempDir(), IsDefault: kind == "default"}
		if err := db.Create(&bucket).Error; err != nil {
			t.Fatal(err)
		}
		file := models.FileMetadata{StorageBucketID: bucket.ID, Path: "file.iso", Type: "iso"}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		if kind == "referenced" {
			if err := db.Create(&models.BuildTask{TaskID: kind, StorageBucketID: bucket.ID, Status: "completed"}).Error; err != nil {
				t.Fatal(err)
			}
		}
		res, err := app.Test(httptest.NewRequest("DELETE", fmt.Sprintf("/buckets/%d", bucket.ID), nil))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		want := 409
		if kind == "unused" {
			want = 200
		}
		if res.StatusCode != want {
			t.Fatalf("%s: %d", kind, res.StatusCode)
		}
		var count int64
		db.Unscoped().Model(&models.FileMetadata{}).Where("storage_bucket_id = ?", bucket.ID).Count(&count)
		if kind == "unused" && count != 0 {
			t.Fatal("orphan metadata")
		}
	}
}

func TestFileDownloadAuthenticatedStreamingAndSafeNames(t *testing.T) {
	db := regressionDB(t)
	root := t.TempDir()
	bucket := models.StorageBucket{Name: "local", Type: "local", LocalPath: root}
	db.Create(&bucket)
	name := "测试 image.iso"
	if err := os.WriteFile(filepath.Join(root, name), []byte("actual bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	file := models.FileMetadata{StorageBucketID: bucket.ID, Path: name, Type: "iso"}
	db.Create(&file)
	app := fiber.New()
	app.Get("/files/:id/download", middleware.TokenAuth("test-token", "X-API-Token"), NewFileHandler(services.NewFileService(db, nil)).Download)
	url := fmt.Sprintf("/files/%d/download", file.ID)
	res, err := app.Test(httptest.NewRequest("GET", url, nil))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("unprotected: %d", res.StatusCode)
	}
	req := httptest.NewRequest("GET", url, nil)
	req.Header.Set("X-API-Token", "test-token")
	res, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(res.Body)
	res.Body.Close()
	_, params, err := mime.ParseMediaType(res.Header.Get("Content-Disposition"))
	if err != nil || params["filename"] != name {
		t.Fatalf("disposition %v %v", params, err)
	}
	if res.StatusCode != 200 || string(data) != "actual bytes" {
		t.Fatalf("download: %d %s", res.StatusCode, data)
	}
	db.Model(&file).Update("path", "../escape.iso")
	res, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode == 200 {
		t.Fatal("unsafe path served")
	}
	for _, id := range []string{"0", "abc", "184467440737095516160000"} {
		req := httptest.NewRequest("GET", "/files/"+id+"/download", nil)
		req.Header.Set("X-API-Token", "test-token")
		res, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 400 {
			t.Fatalf("id %s: %d", id, res.StatusCode)
		}
	}
}
