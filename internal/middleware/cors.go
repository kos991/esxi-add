package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	fiberCors "github.com/gofiber/fiber/v2/middleware/cors"
)

const defaultCORSOrigins = "http://localhost:5173,http://127.0.0.1:5173"

func CORS(allowedOrigins ...string) fiber.Handler {
	origins := defaultCORSOrigins
	if len(allowedOrigins) > 0 && strings.TrimSpace(allowedOrigins[0]) != "" {
		origins = strings.TrimSpace(allowedOrigins[0])
	}
	return fiberCors.New(fiberCors.Config{
		AllowOrigins: origins,
	})
}
