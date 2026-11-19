package handlers

import (
	fiberws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/builder"
	appconfig "github.com/esxi-builder/esxi-iso-builder/internal/config"
	"github.com/esxi-builder/esxi-iso-builder/internal/middleware"
	"github.com/esxi-builder/esxi-iso-builder/internal/services"
	taskws "github.com/esxi-builder/esxi-iso-builder/internal/websocket"
)

func RegisterRoutes(app *fiber.App, db *gorm.DB, cfg *appconfig.Config, taskClient *asynq.Client, wsManager *taskws.Manager) {
	healthHandler := NewHealthHandler(db)
	healthHandler.SetVersion(cfg.Server.AppVersion)
	systemStatusHandler := NewSystemStatusHandler()
	systemStatusHandler.SetVersion(cfg.Server.AppVersion)
	adminAuth := NewAdminAuthManager(db, cfg)

	bucketHandler := NewBucketHandler(db)
	fileService := services.NewFileService(db, nil)
	fileService.SetCacheRoot(cfg.Build.WorkDir)
	fileHandler := NewFileHandler(fileService)

	buildHandler := NewBuildHandler(db, taskClient, cfg.Build.Mode)
	buildHandler.SetWorkDir(cfg.Build.WorkDir)
	buildHandler.SetImageProfileInspector(builder.NewPowerShellExecutor(cfg.Build.PowerShellPath, cfg.Build.ScriptPath))
	workerHandler := NewWorkerHandler(db, cfg.Build.WorkerToken)
	wsHandler := NewWebSocketHandler(db, wsManager)

	app.Get("/health", healthHandler.Check)

	api := app.Group("/api")
	protectedAPI := api.Group("", middleware.TokenAuth(cfg.Server.APIToken, "X-API-Token"), adminAuth.AttachIdentity())
	requireAdmin := adminAuth.RequireAdmin()

	protectedAPI.Get("/auth/status", adminAuth.Status)
	protectedAPI.Post("/auth/setup", adminAuth.Setup)
	protectedAPI.Post("/auth/login", adminAuth.Login)
	protectedAPI.Post("/auth/logout", adminAuth.Logout)
	protectedAPI.Put("/auth/password", requireAdmin, adminAuth.ChangePassword)

	protectedAPI.Get("/system/status", systemStatusHandler.Get)

	// 构建流水线需读取桶列表以选择默认盘与 S3 归档目标（未登录管理员时自动脱敏 AccessKey/Endpoint/LocalPath）
	protectedAPI.Get("/buckets", bucketHandler.List)
	protectedAPI.Post("/buckets/test-config", requireAdmin, bucketHandler.TestConfig)
	protectedAPI.Post("/buckets", requireAdmin, bucketHandler.Create)
	protectedAPI.Get("/buckets/:id", requireAdmin, bucketHandler.Get)
	protectedAPI.Put("/buckets/:id", requireAdmin, bucketHandler.Update)
	protectedAPI.Delete("/buckets/:id", requireAdmin, bucketHandler.Delete)
	protectedAPI.Post("/buckets/:id/test", requireAdmin, bucketHandler.TestConnection)
	protectedAPI.Put("/buckets/:id/default", requireAdmin, bucketHandler.SetDefault)

	// 镜像源/驱动列表与产物下载对访客开放；上传、重命名、删除、刷新缓存与手动转存需管理员登录
	protectedAPI.Get("/files", fileHandler.List)
	protectedAPI.Get("/files/depots", fileHandler.ListDepots)
	protectedAPI.Get("/files/drivers", fileHandler.ListDrivers)
	protectedAPI.Get("/files/isos", fileHandler.ListISOs)
	protectedAPI.Post("/files/upload", requireAdmin, fileHandler.UploadFile)
	protectedAPI.Get("/files/:id/download", fileHandler.Download)
	protectedAPI.Get("/files/:id/presign", fileHandler.PresignDownloadURL)
	protectedAPI.Put("/files/:id/rename", requireAdmin, fileHandler.RenameFile)
	protectedAPI.Delete("/files/:id", requireAdmin, fileHandler.DeleteFile)
	protectedAPI.Post("/files/refresh", requireAdmin, fileHandler.RefreshCache)
	protectedAPI.Post("/files/archive-outputs-s3", requireAdmin, fileHandler.ArchiveOutputsToS3)
	protectedAPI.Post("/files/:id/archive-s3", requireAdmin, fileHandler.ArchiveToS3)

	// 构建与产物下载对访客开放；清理历史记录与手动转存清理需管理员登录
	protectedAPI.Post("/builds", buildHandler.Create)
	protectedAPI.Post("/builds/preflight", buildHandler.StartPreflight)
	protectedAPI.Get("/builds/preflight/:id", buildHandler.GetPreflight)
	protectedAPI.Get("/builds", buildHandler.List)
	protectedAPI.Get("/builds/:id", buildHandler.Get)
	protectedAPI.Delete("/builds/:id", requireAdmin, buildHandler.Delete)
	protectedAPI.Get("/builds/:id/logs", buildHandler.GetLogs)
	protectedAPI.Get("/builds/:id/artifact", buildHandler.DownloadArtifact)
	protectedAPI.Get("/builds/:id/artifact-url", buildHandler.GetArtifactDownloadURL)
	protectedAPI.Post("/builds/:id/archive-s3", requireAdmin, buildHandler.ArchiveToS3)

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
