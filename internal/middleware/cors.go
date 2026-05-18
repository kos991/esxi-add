package middleware

import (
    fiberCors "github.com/gofiber/fiber/v2/middleware/cors"
    "github.com/gofiber/fiber/v2"
)

func CORS() fiber.Handler {
    return fiberCors.New(fiberCors.Config{
        AllowOrigins: "*",
    })
}
