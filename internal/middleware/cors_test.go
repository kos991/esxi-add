package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestCORSDoesNotAllowArbitraryOriginsByDefault(t *testing.T) {
	app := fiber.New()
	app.Use(CORS())
	app.Get("/api/test", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	req.Header.Set(fiber.HeaderOrigin, "https://evil.example")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("cors request: %v", err)
	}
	if got := resp.Header.Get(fiber.HeaderAccessControlAllowOrigin); got != "" {
		t.Fatalf("expected arbitrary origin not to be allowed, got %q", got)
	}
}

func TestCORSAllowsAPITokenHeaderForConfiguredOrigins(t *testing.T) {
	app := fiber.New()
	app.Use(CORS("http://localhost:5173"))
	app.Get("/api/test", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodOptions, "/api/test", nil)
	req.Header.Set(fiber.HeaderOrigin, "http://localhost:5173")
	req.Header.Set(fiber.HeaderAccessControlRequestMethod, http.MethodGet)
	req.Header.Set(fiber.HeaderAccessControlRequestHeaders, "X-API-Token")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("cors preflight request: %v", err)
	}
	if got := resp.Header.Get(fiber.HeaderAccessControlAllowOrigin); got != "http://localhost:5173" {
		t.Fatalf("expected configured origin to be allowed, got %q", got)
	}
	if got := resp.Header.Get(fiber.HeaderAccessControlAllowHeaders); !strings.Contains(got, "X-API-Token") {
		t.Fatalf("expected X-API-Token header to be allowed, got %q", got)
	}
}
