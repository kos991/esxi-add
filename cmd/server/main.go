package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/gofiber/fiber/v2"
	"github.com/hibiken/asynq"
	"go.uber.org/zap"

	"github.com/esxi-builder/esxi-iso-builder/internal/builder"
	"github.com/esxi-builder/esxi-iso-builder/internal/config"
	"github.com/esxi-builder/esxi-iso-builder/internal/database"
	"github.com/esxi-builder/esxi-iso-builder/internal/handlers"
	"github.com/esxi-builder/esxi-iso-builder/internal/middleware"
	"github.com/esxi-builder/esxi-iso-builder/internal/queue"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
	"github.com/esxi-builder/esxi-iso-builder/internal/utils"
	appws "github.com/esxi-builder/esxi-iso-builder/internal/websocket"
)

func main() {
	if err := utils.InitLogger(); err != nil {
		log.Fatalf("failed to initialize logger: %v", err)
	}
	defer func() {
		if utils.Logger != nil {
			_ = utils.Logger.Sync()
		}
	}()

	cfg, err := config.Load()
	if err != nil {
		utils.Logger.Fatal("failed to load config", zap.Error(err))
	}

	if err := ensureRuntimeDirectories(cfg); err != nil {
		utils.Logger.Fatal("failed to prepare runtime directories", zap.Error(err))
	}

	db, err := database.InitDB(cfg.Database.Path)
	if err != nil {
		utils.Logger.Fatal("failed to initialize database", zap.Error(err))
	}
	if err := database.EnsureDefaultStorageBucket(db, cfg); err != nil {
		utils.Logger.Fatal("failed to ensure default storage bucket", zap.Error(err))
	}

	if sqlDB, err := db.DB(); err == nil {
		defer sqlDB.Close()
	}

	taskClient := queue.NewClient(queue.Config{
		RedisAddr:     cfg.Redis.Addr,
		RedisPassword: cfg.Redis.Password,
		RedisDB:       cfg.Redis.DB,
		Concurrency:   cfg.Queue.Concurrency,
	})
	defer taskClient.Close()

	executor := builder.NewPowerShellExecutor(cfg.Build.PowerShellPath, cfg.Build.ScriptPath)

	var s3Client *storage.S3Client
	if cfg.Storage.S3.Endpoint != "" && cfg.Storage.S3.BucketName != "" {
		client, err := storage.NewS3Client(&storage.S3Config{
			Endpoint:        cfg.Storage.S3.Endpoint,
			AccessKeyID:     cfg.Storage.S3.AccessKey,
			SecretAccessKey: cfg.Storage.S3.SecretKey,
			BucketName:      cfg.Storage.S3.BucketName,
			Region:          cfg.Storage.S3.Region,
			UseSSL:          cfg.Storage.S3.UseSSL,
			PublicDomain:    cfg.Storage.S3.PublicDomain,
		})
		if err != nil {
			utils.Logger.Warn("failed to initialize default s3 client; bucket-specific clients will be used", zap.Error(err))
		} else {
			s3Client = client
		}
	}

	var cacheManager *storage.CacheManager
	if s3Client != nil {
		cacheManager = storage.NewCacheManager(filepath.Join(cfg.Build.WorkDir, "cache"), s3Client)
	}

	wsManager := appws.NewManager()

	// Start Asynq worker server
	asynqSrv := queue.NewServer(queue.Config{
		RedisAddr:     cfg.Redis.Addr,
		RedisPassword: cfg.Redis.Password,
		RedisDB:       cfg.Redis.DB,
		Concurrency:   cfg.Queue.Concurrency,
	})

	buildTaskHandler := queue.NewBuildTaskHandler(db, executor, cacheManager, s3Client, cfg.Build.WorkDir, wsManager)

	mux := asynq.NewServeMux()
	mux.HandleFunc(queue.TypeBuildISO, buildTaskHandler.HandleBuildISO)

	go func() {
		if err := asynqSrv.Run(mux); err != nil {
			utils.Logger.Error("asynq worker failed", zap.Error(err))
		}
	}()

	app := fiber.New(fiber.Config{
		ErrorHandler: middleware.ErrorHandler,
	})

	app.Use(middleware.Logger())
	app.Use(middleware.CORS())

	handlers.RegisterRoutes(app, db, cfg, taskClient, wsManager)

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	serverErr := make(chan error, 1)

	go func() {
		serverErr <- app.Listen(addr)
	}()

	utils.Logger.Info("server starting", zap.String("address", addr))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	select {
	case err := <-serverErr:
		if err != nil {
			utils.Logger.Fatal("server exited", zap.Error(err))
		}
		return
	case <-ctx.Done():
		utils.Logger.Info("shutdown signal received")
	}

	if err := app.Shutdown(); err != nil {
		utils.Logger.Error("graceful shutdown failed", zap.Error(err))
	}

	if err := <-serverErr; err != nil {
		utils.Logger.Error("server returned during shutdown", zap.Error(err))
	}
}

func ensureRuntimeDirectories(cfg *config.Config) error {
	directories := []string{
		cfg.Storage.LocalPath,
		cfg.Build.WorkDir,
		filepath.Dir(cfg.Database.Path),
	}

	for _, dir := range directories {
		if dir == "" || dir == "." {
			continue
		}

		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create directory %s: %w", dir, err)
		}
	}

	return nil
}
