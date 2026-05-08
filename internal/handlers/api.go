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
	fileService.SetCacheRoot(cfg.Build.WorkDir)
	fileHandler := NewFileHandler(fileService)

	buildHandler := NewBuildHandler(db, taskClient, cfg.Build.Mode)
	buildHandler.SetWorkDir(cfg.Build.WorkDir)
	workerHandler := NewWorkerHandler(db, cfg.Build.WorkerToken)
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
	api.Put("/files/:id/rename", fileHandler.RenameFile)
	api.Delete("/files/:id", fileHandler.DeleteFile)
	api.Post("/files/refresh", fileHandler.RefreshCache)

	api.Post("/builds", buildHandler.Create)
	api.Post("/builds/preflight", buildHandler.StartPreflight)
	api.Get("/builds/preflight/:id", buildHandler.GetPreflight)
	api.Get("/builds", buildHandler.List)
	api.Get("/builds/:id", buildHandler.Get)
	api.Delete("/builds/:id", buildHandler.Delete)
	api.Get("/builds/:id/logs", buildHandler.GetLogs)
	api.Get("/builds/:id/artifact", buildHandler.DownloadArtifact)

	api.Post("/worker/builds/claim", workerHandler.ClaimBuild)
	api.Post("/worker/builds/:id/progress", workerHandler.UpdateProgress)
	api.Post("/worker/builds/:id/artifact", workerHandler.UploadArtifact)
	api.Get("/worker/files", workerHandler.DownloadFile)

	app.Use("/ws", func(c *fiber.Ctx) error {
		if fiberws.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get("/ws/builds/:id", fiberws.New(wsHandler.HandleTaskLogs))
}
