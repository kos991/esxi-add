package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestTokenAuthRequiresConfiguredToken(t *testing.T) {
	app := fiber.New()
	app.Use(TokenAuth("secret", "X-API-Token"))
	app.Get("/protected", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusNoContent)
	})

	missingReq := httptest.NewRequest(http.MethodGet, "/protected", nil)
	missingReq.RemoteAddr = "192.0.2.10:1234"
	missingResp, err := app.Test(missingReq)
	if err != nil {
		t.Fatalf("missing token request: %v", err)
	}
	if missingResp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("expected missing token to be rejected, got %d", missingResp.StatusCode)
	}

	tokenReq := httptest.NewRequest(http.MethodGet, "/protected", nil)
	tokenReq.RemoteAddr = "192.0.2.10:1234"
	tokenReq.Header.Set("X-API-Token", "secret")
	tokenResp, err := app.Test(tokenReq)
	if err != nil {
		t.Fatalf("token request: %v", err)
	}
	if tokenResp.StatusCode != fiber.StatusNoContent {
		t.Fatalf("expected configured token to pass, got %d", tokenResp.StatusCode)
	}
}

func TestTokenAuthWithoutTokenAllowsRequests(t *testing.T) {
	app := fiber.New(fiber.Config{ProxyHeader: fiber.HeaderXForwardedFor})
	app.Use(TokenAuth("", "X-API-Token"))
	app.Get("/protected", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusNoContent)
	})

	loopbackReq := httptest.NewRequest(http.MethodGet, "/protected", nil)
	loopbackReq.RemoteAddr = "127.0.0.1:1234"
	loopbackReq.Header.Set(fiber.HeaderXForwardedFor, "127.0.0.1")
	loopbackResp, err := app.Test(loopbackReq)
	if err != nil {
		t.Fatalf("loopback request: %v", err)
	}
	if loopbackResp.StatusCode != fiber.StatusNoContent {
		t.Fatalf("expected loopback request to pass, got %d", loopbackResp.StatusCode)
	}

	remoteReq := httptest.NewRequest(http.MethodGet, "/protected", nil)
	remoteReq.RemoteAddr = "192.0.2.10:1234"
	remoteReq.Header.Set(fiber.HeaderXForwardedFor, "192.0.2.10")
	remoteResp, err := app.Test(remoteReq)
	if err != nil {
		t.Fatalf("remote request: %v", err)
	}
	if remoteResp.StatusCode != fiber.StatusNoContent {
		t.Fatalf("expected remote request without configured token to pass, got %d", remoteResp.StatusCode)
	}
}
