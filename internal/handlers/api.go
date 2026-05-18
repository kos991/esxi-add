package handlers

import (
	fiberws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	appconfig "github.com/esxi-builder/esxi-iso-builder/internal/config"
	"github.com/esxi-builder/esxi-iso-builder/internal/middleware"
	"github.com/esxi-builder/esxi-iso-builder/internal/services"
	taskws "github.com/esxi-builder/esxi-iso-builder/internal/websocket"
)

func RegisterRoutes(app *fiber.App, db *gorm.DB, cfg *appconfig.Config, taskClient *asynq.Client, wsManager *taskws.Manager) {
	healthHandler := NewHealthHandler(db)
	systemStatusHandler := NewSystemStatusHandler()
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
	protectedAPI := api.Group("", middleware.TokenAuth(cfg.Server.APIToken, "X-API-Token"))

	protectedAPI.Get("/system/status", systemStatusHandler.Get)

	protectedAPI.Get("/buckets", bucketHandler.List)
	protectedAPI.Post("/buckets", bucketHandler.Create)
	protectedAPI.Get("/buckets/:id", bucketHandler.Get)
	protectedAPI.Put("/buckets/:id", bucketHandler.Update)
	protectedAPI.Delete("/buckets/:id", bucketHandler.Delete)
	protectedAPI.Post("/buckets/:id/test", bucketHandler.TestConnection)
	protectedAPI.Put("/buckets/:id/default", bucketHandler.SetDefault)

	protectedAPI.Get("/files/depots", fileHandler.ListDepots)
	protectedAPI.Get("/files/drivers", fileHandler.ListDrivers)
	protectedAPI.Get("/files/isos", fileHandler.ListISOs)
	protectedAPI.Post("/files/upload", fileHandler.UploadFile)
	protectedAPI.Put("/files/:id/rename", fileHandler.RenameFile)
	protectedAPI.Delete("/files/:id", fileHandler.DeleteFile)
	protectedAPI.Post("/files/refresh", fileHandler.RefreshCache)

	protectedAPI.Post("/builds", buildHandler.Create)
	protectedAPI.Post("/builds/preflight", buildHandler.StartPreflight)
	protectedAPI.Get("/builds/preflight/:id", buildHandler.GetPreflight)
	protectedAPI.Get("/builds", buildHandler.List)
	protectedAPI.Get("/builds/:id", buildHandler.Get)
	protectedAPI.Delete("/builds/:id", buildHandler.Delete)
	protectedAPI.Get("/builds/:id/logs", buildHandler.GetLogs)
	protectedAPI.Get("/builds/:id/artifact", buildHandler.DownloadArtifact)

	workerAPI := api.Group("/worker")
	workerAPI.Post("/builds/claim", workerHandler.ClaimBuild)
	workerAPI.Post("/builds/:id/progress", workerHandler.UpdateProgress)
	workerAPI.Post("/builds/:id/artifact", workerHandler.UploadArtifact)
	workerAPI.Get("/files", workerHandler.DownloadFile)

	app.Use("/ws", middleware.TokenAuth(cfg.Server.APIToken, "X-API-Token"), func(c *fiber.Ctx) error {
		if fiberws.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get("/ws/builds/:id", fiberws.New(wsHandler.HandleTaskLogs))
}
