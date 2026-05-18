package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	appconfig "github.com/esxi-builder/esxi-iso-builder/internal/config"
	"github.com/esxi-builder/esxi-iso-builder/internal/websocket"
)

func TestRegisterRoutesProtectsAPIRoutesWithConfiguredToken(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	app := fiber.New()
	RegisterRoutes(app, db, &appconfig.Config{
		Server: appconfig.ServerConfig{APIToken: "api-secret"},
		Build:  appconfig.BuildConfig{Mode: "external", WorkDir: t.TempDir(), WorkerToken: "worker-secret"},
	}, nil, websocket.NewManager())

	missingReq := httptest.NewRequest(http.MethodGet, "/api/system/status", nil)
	missingReq.RemoteAddr = "192.0.2.10:1234"
	missingResp, err := app.Test(missingReq)
	if err != nil {
		t.Fatalf("missing token request: %v", err)
	}
	if missingResp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("expected protected API route to reject missing token, got %d", missingResp.StatusCode)
	}

	tokenReq := httptest.NewRequest(http.MethodGet, "/api/system/status", nil)
	tokenReq.RemoteAddr = "192.0.2.10:1234"
	tokenReq.Header.Set("X-API-Token", "api-secret")
	tokenResp, err := app.Test(tokenReq)
	if err != nil {
		t.Fatalf("token request: %v", err)
	}
	if tokenResp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected protected API route to accept configured token, got %d", tokenResp.StatusCode)
	}
}
