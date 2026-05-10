package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestSystemStatusHandlerReturnsRuntimeMetrics(t *testing.T) {
	app := fiber.New()
	app.Get("/system/status", NewSystemStatusHandler().Get)

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/system/status", nil))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	var response struct {
		Success bool         `json:"success"`
		Data    SystemStatus `json:"data"`
		Error   string       `json:"error,omitempty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if !response.Success {
		t.Fatalf("expected success response, got %q", response.Error)
	}
	if response.Data.CPU.Cores <= 0 {
		t.Fatalf("expected cpu core count, got %+v", response.Data.CPU)
	}
	if response.Data.Memory.TotalBytes == 0 {
		t.Fatalf("expected memory total, got %+v", response.Data.Memory)
	}
}
