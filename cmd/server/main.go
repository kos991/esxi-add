package main

import (
	"context"
	"fmt"
	"log"
	"mime"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
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
	"github.com/esxi-builder/esxi-iso-builder/internal/utils"
	appws "github.com/esxi-builder/esxi-iso-builder/internal/websocket"
)

const maxUploadBodySize = 4 * 1024 * 1024 * 1024

func serverFiberConfig() fiber.Config {
	return fiber.Config{
		BodyLimit:    maxUploadBodySize,
		ErrorHandler: middleware.ErrorHandler,
	}
}

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

	wsManager := appws.NewManager()

	if strings.EqualFold(strings.TrimSpace(cfg.Build.Mode), "external") {
		utils.Logger.Info("external build mode enabled; local PowerShell worker is disabled")
	} else {
		// Start Asynq worker server
		asynqSrv := queue.NewServer(queue.Config{
			RedisAddr:     cfg.Redis.Addr,
			RedisPassword: cfg.Redis.Password,
			RedisDB:       cfg.Redis.DB,
			Concurrency:   cfg.Queue.Concurrency,
		})

		buildTaskHandler := queue.NewBuildTaskHandler(db, executor, cfg.Build.WorkDir, wsManager)

		mux := asynq.NewServeMux()
		mux.HandleFunc(queue.TypeBuildISO, buildTaskHandler.HandleBuildISO)

		go func() {
			if err := asynqSrv.Run(mux); err != nil {
				utils.Logger.Error("asynq worker failed", zap.Error(err))
			}
		}()
	}

	app := fiber.New(serverFiberConfig())

	app.Use(middleware.Logger())
	app.Use(middleware.CORS())

	handlers.RegisterRoutes(app, db, cfg, taskClient, wsManager)
	registerFrontendRoutes(app, frontendDistDir())

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

func frontendDistDir() string {
	if dir := strings.TrimSpace(os.Getenv("FRONTEND_DIST_DIR")); dir != "" {
		return dir
	}

	return "/app/frontend/dist"
}

func registerFrontendRoutes(app *fiber.App, distDir string) {
	indexPath := filepath.Join(distDir, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		return
	}

	app.Get("*", func(c *fiber.Ctx) error {
		if isBackendNamespace(c.Path()) {
			return fiber.ErrNotFound
		}

		if filePath, ok := frontendAssetPath(distDir, c.Path()); ok {
			if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
				return sendFrontendFile(c, filePath)
			}
		}

		return sendFrontendFile(c, indexPath)
	})
}

func isBackendNamespace(path string) bool {
	return path == "/health" ||
		path == "/api" ||
		strings.HasPrefix(path, "/api/") ||
		path == "/ws" ||
		strings.HasPrefix(path, "/ws/")
}

func frontendAssetPath(distDir, requestPath string) (string, bool) {
	cleanPath := path.Clean("/" + requestPath)
	if cleanPath == "/" {
		return "", false
	}

	relPath := strings.TrimPrefix(cleanPath, "/")
	filePath := filepath.Join(distDir, filepath.FromSlash(relPath))

	absDist, err := filepath.Abs(distDir)
	if err != nil {
		return "", false
	}
	absFile, err := filepath.Abs(filePath)
	if err != nil {
		return "", false
	}
	relToDist, err := filepath.Rel(absDist, absFile)
	if err != nil || relToDist == ".." || strings.HasPrefix(relToDist, ".."+string(filepath.Separator)) {
		return "", false
	}

	return absFile, true
}

func sendFrontendFile(c *fiber.Ctx, filePath string) error {
	body, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return fiber.ErrNotFound
		}
		return err
	}

	if contentType := mime.TypeByExtension(filepath.Ext(filePath)); contentType != "" {
		c.Set(fiber.HeaderContentType, contentType)
	}
	return c.Send(body)
}
