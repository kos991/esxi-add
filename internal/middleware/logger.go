package middleware

import (
    "time"

    "github.com/gofiber/fiber/v2"
    "go.uber.org/zap"

    "github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

func Logger() fiber.Handler {
    return func(c *fiber.Ctx) error {
        start := time.Now()
        err := c.Next()

        logger := utils.Logger
        if logger == nil {
            logger = zap.L()
        }

        fields := []zap.Field{
            zap.String("method", c.Method()),
            zap.String("path", c.OriginalURL()),
            zap.Int("status", c.Response().StatusCode()),
            zap.Duration("duration", time.Since(start)),
            zap.String("ip", c.IP()),
        }

        if err != nil {
            fields = append(fields, zap.Error(err))
        }

        logger.Info("http request", fields...)
        return err
    }
}
