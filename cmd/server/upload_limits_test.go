package main

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

const (
	minimumDepotUploadBodyLimit = 2 * 1024 * 1024 * 1024
	overDefaultFiberBodyLimit   = 5 * 1024 * 1024
)

func TestServerFiberConfigAllowsDepotSizedUploads(t *testing.T) {
	cfg := serverFiberConfig()
	if cfg.BodyLimit < minimumDepotUploadBodyLimit {
		t.Fatalf("expected body limit to be at least %d bytes, got %d", minimumDepotUploadBodyLimit, cfg.BodyLimit)
	}

	app := fiber.New(cfg)
	t.Cleanup(func() {
		_ = app.Shutdown()
	})
	app.Post("/api/files/upload", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusCreated)
	})

	body := strings.Repeat("a", overDefaultFiberBodyLimit)
	req, err := http.NewRequest(http.MethodPost, "/api/files/upload", strings.NewReader(body))
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.ContentLength = int64(len(body))

	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("perform request: %v", err)
	}
	defer resp.Body.Close()

	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("expected large upload request to reach handler, got status %d", resp.StatusCode)
	}
}
