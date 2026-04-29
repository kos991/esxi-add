package handlers

import (
	fiberws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	appconfig "github.com/esxi-builder/esxi-iso-builder/internal/config"
	"github.com/esxi-builder/esxi-iso-builder/internal/services"
	taskws "github.com/esxi-builder/esxi-iso-builder/internal/websocket"
)

func RegisterRoutes(app *fiber.App, db *gorm.DB, cfg *appconfig.Config, taskClient *asynq.Client, wsManager *taskws.Manager) {
	healthHandler := NewHealthHandler(db)
	bucketHandler := NewBucketHandler(db)
	fileService := services.NewFileService(db, nil)
	fileHandler := NewFileHandler(fileService)

	_ = cfg
	buildHandler := NewBuildHandler(db, taskClient)
	wsHandler := NewWebSocketHandler(db, wsManager)

	app.Get("/health", healthHandler.Check)

	api := app.Group("/api")

	api.Get("/buckets", bucketHandler.List)
	api.Post("/buckets", bucketHandler.Create)
	api.Get("/buckets/:id", bucketHandler.Get)
	api.Put("/buckets/:id", bucketHandler.Update)
	api.Delete("/buckets/:id", bucketHandler.Delete)
	api.Post("/buckets/:id/test", bucketHandler.TestConnection)
	api.Put("/buckets/:id/default", bucketHandler.SetDefault)

	api.Get("/files/depots", fileHandler.ListDepots)
	api.Get("/files/drivers", fileHandler.ListDrivers)
	api.Get("/files/isos", fileHandler.ListISOs)
	api.Post("/files/upload", fileHandler.UploadFile)
	api.Delete("/files/:id", fileHandler.DeleteFile)
	api.Post("/files/refresh", fileHandler.RefreshCache)

	api.Post("/builds", buildHandler.Create)
	api.Get("/builds", buildHandler.List)
	api.Get("/builds/:id", buildHandler.Get)
	api.Delete("/builds/:id", buildHandler.Delete)
	api.Get("/builds/:id/logs", buildHandler.GetLogs)

	app.Use("/ws", func(c *fiber.Ctx) error {
		if fiberws.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get("/ws/builds/:id", fiberws.New(wsHandler.HandleTaskLogs))
}
