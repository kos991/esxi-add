package middleware

import (
	"crypto/subtle"
	"net"
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

func isLoopbackRequest(c *fiber.Ctx) bool {
	peerIP := c.Context().RemoteIP()
	if (peerIP == nil || peerIP.IsLoopback() || peerIP.IsUnspecified()) && strings.TrimSpace(c.Get(fiber.HeaderXForwardedFor)) != "" {
		if forwardedIP := parseForwardedFor(c.Get(fiber.HeaderXForwardedFor)); forwardedIP != nil {
			return forwardedIP.IsLoopback()
		}
	}
	if peerIP != nil && peerIP.IsLoopback() {
		return true
	}

	host, _, err := net.SplitHostPort(c.Context().RemoteAddr().String())
	if err == nil {
		if ip := net.ParseIP(host); ip != nil {
			return ip.IsLoopback()
		}
	}
	if ip := net.ParseIP(c.IP()); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

func parseForwardedFor(value string) net.IP {
	first := strings.TrimSpace(strings.Split(value, ",")[0])
	if first == "" {
		return nil
	}
	return net.ParseIP(first)
}
