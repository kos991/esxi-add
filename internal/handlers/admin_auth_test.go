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

	appconfig "github.com/esxi-builder/esxi-iso-builder/internal/config"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/websocket"
)

func newAdminTestApp(t *testing.T, cfg *appconfig.Config) (*fiber.App, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.StorageBucket{}, &models.FileMetadata{}, &models.BuildTask{}, &models.SystemSetting{}); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	app := fiber.New()
	if cfg == nil {
		cfg = &appconfig.Config{}
	}
	if cfg.Build.WorkDir == "" {
		cfg.Build.WorkDir = t.TempDir()
	}
	cfg.Build.Mode = "external"
	RegisterRoutes(app, db, cfg, nil, websocket.NewManager())
	return app, db
}

func TestAdminSetupLoginPasswordChangeAndGuestRedaction(t *testing.T) {
	app, db := newAdminTestApp(t, &appconfig.Config{
		Server: appconfig.ServerConfig{AppVersion: "dev"},
	})

	bucket := models.StorageBucket{
		Name:       "Bitiful S3",
		Type:       models.StorageTypeS3,
		Endpoint:   "https://s3.example.com",
		AccessKey:  "AKIA_TEST_SECRET_ID",
		SecretKey:  "SUPER_SECRET",
		BucketName: "esxi-build",
		Region:     "cn-east-1",
		IsDefault:  true,
	}
	if err := db.Create(&bucket).Error; err != nil {
		t.Fatalf("seed bucket: %v", err)
	}

	// 1. Check initial auth status and version fallback ("dev" -> DefaultAppVersion "v1.0.1")
	statusReq := httptest.NewRequest(http.MethodGet, "/api/auth/status", nil)
	statusResp, err := app.Test(statusReq)
	if err != nil {
		t.Fatalf("auth status: %v", err)
	}
	var statusBody struct {
		Success bool `json:"success"`
		Data    struct {
			Version       string `json:"version"`
			Configured    bool   `json:"configured"`
			Authenticated bool   `json:"authenticated"`
			EnvManaged    bool   `json:"env_managed"`
		} `json:"data"`
	}
	if err := json.NewDecoder(statusResp.Body).Decode(&statusBody); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if statusBody.Data.Version != "v1.0.1" || statusBody.Data.Configured || statusBody.Data.Authenticated {
		t.Fatalf("unexpected initial auth status: %+v", statusBody.Data)
	}

	// 2. Guest can read /api/buckets for BuildPage, but sensitive fields are redacted
	guestBucketsReq := httptest.NewRequest(http.MethodGet, "/api/buckets", nil)
	guestBucketsResp, err := app.Test(guestBucketsReq)
	if err != nil {
		t.Fatalf("guest list buckets: %v", err)
	}
	var guestBuckets struct {
		Data []models.StorageBucket `json:"data"`
	}
	_ = json.NewDecoder(guestBucketsResp.Body).Decode(&guestBuckets)
	if len(guestBuckets.Data) != 1 || guestBuckets.Data[0].AccessKey != "" || guestBuckets.Data[0].Endpoint != "" {
		t.Fatalf("expected guest bucket list to redact AccessKey and Endpoint, got %+v", guestBuckets.Data)
	}

	// 3. Unauthenticated admin mutation is rejected with 401 admin_setup_required
	delTaskReq := httptest.NewRequest(http.MethodDelete, "/api/builds/nonexistent", nil)
	delTaskResp, err := app.Test(delTaskReq)
	if err != nil {
		t.Fatalf("guest delete task: %v", err)
	}
	if delTaskResp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("expected 401 before setup, got %d", delTaskResp.StatusCode)
	}

	// 4. First-time setup creates password and returns valid token
	setupReq := httptest.NewRequest(http.MethodPost, "/api/auth/setup", strings.NewReader(`{"password":"strong-pass-123"}`))
	setupReq.Header.Set("Content-Type", "application/json")
	setupResp, err := app.Test(setupReq)
	if err != nil {
		t.Fatalf("setup password: %v", err)
	}
	if setupResp.StatusCode != fiber.StatusCreated {
		t.Fatalf("expected 201 on setup, got %d", setupResp.StatusCode)
	}
	var setupData struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	_ = json.NewDecoder(setupResp.Body).Decode(&setupData)
	firstToken := setupData.Data.Token
	if firstToken == "" {
		t.Fatalf("expected session token from setup")
	}

	// Second setup attempt must fail with 409 Conflict
	dupSetupReq := httptest.NewRequest(http.MethodPost, "/api/auth/setup", strings.NewReader(`{"password":"another-pass"}`))
	dupSetupReq.Header.Set("Content-Type", "application/json")
	dupSetupResp, _ := app.Test(dupSetupReq)
	if dupSetupResp.StatusCode != fiber.StatusConflict {
		t.Fatalf("expected 409 on duplicate setup, got %d", dupSetupResp.StatusCode)
	}

	// 5. Authenticated admin sees Endpoint & AccessKey (still never SecretKey)
	adminBucketsReq := httptest.NewRequest(http.MethodGet, "/api/buckets", nil)
	adminBucketsReq.Header.Set("X-Admin-Token", firstToken)
	adminBucketsResp, _ := app.Test(adminBucketsReq)
	var adminBuckets struct {
		Data []models.StorageBucket `json:"data"`
	}
	_ = json.NewDecoder(adminBucketsResp.Body).Decode(&adminBuckets)
	if len(adminBuckets.Data) != 1 || adminBuckets.Data[0].AccessKey != "AKIA_TEST_SECRET_ID" || adminBuckets.Data[0].SecretKey != "" {
		t.Fatalf("expected admin bucket list to show AccessKey and hide SecretKey, got %+v", adminBuckets.Data)
	}

	// 6. Changing password issues new token and immediately invalidates old token
	changeReq := httptest.NewRequest(http.MethodPut, "/api/auth/password", strings.NewReader(`{"current_password":"strong-pass-123","new_password":"updated-pass-456"}`))
	changeReq.Header.Set("Content-Type", "application/json")
	changeReq.Header.Set("X-Admin-Token", firstToken)
	changeResp, _ := app.Test(changeReq)
	if changeResp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected 200 on password change, got %d", changeResp.StatusCode)
	}
	var changeData struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	_ = json.NewDecoder(changeResp.Body).Decode(&changeData)
	secondToken := changeData.Data.Token

	// Old token must now be rejected
	oldTokenReq := httptest.NewRequest(http.MethodGet, "/api/buckets/1", nil)
	oldTokenReq.Header.Set("X-Admin-Token", firstToken)
	oldTokenResp, _ := app.Test(oldTokenReq)
	if oldTokenResp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("expected old token to be invalidated after password change, got %d", oldTokenResp.StatusCode)
	}

	// New token works
	newTokenReq := httptest.NewRequest(http.MethodGet, "/api/buckets/1", nil)
	newTokenReq.Header.Set("X-Admin-Token", secondToken)
	newTokenResp, _ := app.Test(newTokenReq)
	if newTokenResp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected new token to succeed, got %d", newTokenResp.StatusCode)
	}
}

func TestAdminPasswordEnvOverride(t *testing.T) {
	app, _ := newAdminTestApp(t, &appconfig.Config{
		Server: appconfig.ServerConfig{
			AdminPassword: "env-override-password",
			AppVersion:    "1.0.1",
		},
	})

	statusReq := httptest.NewRequest(http.MethodGet, "/api/auth/status", nil)
	statusResp, _ := app.Test(statusReq)
	var statusBody struct {
		Data struct {
			Version    string `json:"version"`
			Configured bool   `json:"configured"`
			EnvManaged bool   `json:"env_managed"`
		} `json:"data"`
	}
	_ = json.NewDecoder(statusResp.Body).Decode(&statusBody)
	if statusBody.Data.Version != "v1.0.1" || !statusBody.Data.Configured || !statusBody.Data.EnvManaged {
		t.Fatalf("unexpected env-managed status: %+v", statusBody.Data)
	}

	badLoginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"password":"wrong"}`))
	badLoginReq.Header.Set("Content-Type", "application/json")
	badLoginResp, _ := app.Test(badLoginReq)
	if badLoginResp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("expected 401 on wrong env password, got %d", badLoginResp.StatusCode)
	}

	goodLoginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"password":"env-override-password"}`))
	goodLoginReq.Header.Set("Content-Type", "application/json")
	goodLoginResp, _ := app.Test(goodLoginReq)
	if goodLoginResp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected 200 on valid env password, got %d", goodLoginResp.StatusCode)
	}
}
