package middleware

import (
	"crypto/subtle"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

func TokenAuth(token, headerName string) fiber.Handler {
	expected := strings.TrimSpace(token)
	if strings.TrimSpace(headerName) == "" {
		headerName = "X-API-Token"
	}

	return func(c *fiber.Ctx) error {
		if expected == "" {
			return c.Next()
		}

		if constantTimeEqual(requestToken(c, headerName), expected) {
			return c.Next()
		}
		return c.Status(fiber.StatusUnauthorized).JSON(utils.ErrorResponse("invalid api token"))
	}
}

func requestToken(c *fiber.Ctx, headerName string) string {
	if token := strings.TrimSpace(c.Get(headerName)); token != "" {
		return token
	}
	auth := strings.TrimSpace(c.Get(fiber.HeaderAuthorization))
	if before, after, ok := strings.Cut(auth, " "); ok && strings.EqualFold(before, "Bearer") {
		return strings.TrimSpace(after)
	}
	return strings.TrimSpace(c.Query("token"))
}

func constantTimeEqual(actual, expected string) bool {
	actual = strings.TrimSpace(actual)
	expected = strings.TrimSpace(expected)
	if actual == "" || expected == "" || len(actual) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) == 1
}
