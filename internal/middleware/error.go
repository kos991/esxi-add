package middleware

import (
    "errors"

    "github.com/gofiber/fiber/v2"
    "go.uber.org/zap"

    "github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

func ErrorHandler(c *fiber.Ctx, err error) error {
    status := fiber.StatusInternalServerError
    message := "internal server error"

    var fiberErr *fiber.Error
    if errors.As(err, &fiberErr) {
        status = fiberErr.Code
        message = fiberErr.Message
    }

    if utils.Logger != nil {
        utils.Logger.Error("request failed",
            zap.Int("status", status),
            zap.String("method", c.Method()),
            zap.String("path", c.OriginalURL()),
            zap.Error(err),
        )
    }

    return c.Status(status).JSON(utils.ErrorResponse(message))
}
