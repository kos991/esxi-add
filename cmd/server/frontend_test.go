package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestRegisterFrontendRoutesServesStaticAssetsAndSPAFallback(t *testing.T) {
	distDir := createFrontendDist(t)
	app := fiber.New()
	t.Cleanup(func() {
		_ = app.Shutdown()
	})

	registerFrontendRoutes(app, distDir)

	tests := []struct {
		name     string
		path     string
		wantBody string
		wantType string
	}{
		{
			name:     "root",
			path:     "/",
			wantBody: "app shell",
			wantType: "text/html",
		},
		{
			name:     "asset",
			path:     "/assets/app.js",
			wantBody: "console.log('asset')",
			wantType: "javascript",
		},
		{
			name:     "spa route",
			path:     "/builds/123",
			wantBody: "app shell",
			wantType: "text/html",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := performRequest(t, app, tt.path)
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				t.Fatalf("expected status 200, got %d", resp.StatusCode)
			}
			if contentType := resp.Header.Get("Content-Type"); !strings.Contains(contentType, tt.wantType) {
				t.Fatalf("expected content type containing %q, got %q", tt.wantType, contentType)
			}

			body, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatalf("read response body: %v", err)
			}
			if !strings.Contains(string(body), tt.wantBody) {
				t.Fatalf("expected body to contain %q, got %q", tt.wantBody, string(body))
			}
		})
	}
}

func TestRegisterFrontendRoutesDoesNotSwallowBackendNamespaces(t *testing.T) {
	distDir := createFrontendDist(t)
	app := fiber.New()
	t.Cleanup(func() {
		_ = app.Shutdown()
	})

	registerFrontendRoutes(app, distDir)

	for _, path := range []string{"/api/builds", "/ws/builds/1", "/health"} {
		t.Run(path, func(t *testing.T) {
			resp := performRequest(t, app, path)
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("expected status 404, got %d", resp.StatusCode)
			}

			body, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatalf("read response body: %v", err)
			}
			if strings.Contains(string(body), "app shell") {
				t.Fatalf("expected backend namespace not to receive frontend shell, got %q", string(body))
			}
		})
	}
}

func createFrontendDist(t *testing.T) string {
	t.Helper()

	distDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(distDir, "assets"), 0o755); err != nil {
		t.Fatalf("create assets dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "index.html"), []byte("<html><body>app shell</body></html>"), 0o644); err != nil {
		t.Fatalf("write index.html: %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "assets", "app.js"), []byte("console.log('asset')"), 0o644); err != nil {
		t.Fatalf("write app.js: %v", err)
	}

	return distDir
}

func performRequest(t *testing.T, app *fiber.App, path string) *http.Response {
	t.Helper()

	req, err := http.NewRequest(http.MethodGet, path, nil)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("perform request: %v", err)
	}
	return resp
}
