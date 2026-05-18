package handlers

import (
    "github.com/gofiber/fiber/v2"
    "gorm.io/gorm"

    "github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

type HealthHandler struct {
    db *gorm.DB
}

func NewHealthHandler(db *gorm.DB) *HealthHandler {
    return &HealthHandler{db: db}
}

func (h *HealthHandler) Check(c *fiber.Ctx) error {
    sqlDB, err := h.db.DB()
    if err != nil {
        return c.Status(fiber.StatusServiceUnavailable).JSON(utils.ErrorResponse("database unavailable"))
    }

    if err := sqlDB.PingContext(c.UserContext()); err != nil {
        return c.Status(fiber.StatusServiceUnavailable).JSON(utils.ErrorResponse("database disconnected"))
    }

    return c.JSON(utils.SuccessResponse(fiber.Map{
        "status":   "healthy",
        "database": "connected",
    }))
}
