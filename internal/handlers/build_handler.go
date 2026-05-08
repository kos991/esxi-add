package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	taskqueue "github.com/esxi-builder/esxi-iso-builder/internal/queue"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
	"github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

type BuildHandler struct {
	db          *gorm.DB
	taskClient  *asynq.Client
	buildMode   string
	workDir     string
	preflightMu sync.RWMutex
	preflights  map[string]*BuildPreflight
}

type createBuildRequest struct {
	BucketID      uint     `json:"bucket_id"`
	ESXiVersion   string   `json:"esxi_version"`
	DepotPath     string   `json:"depot_path"`
	DriverPaths   []string `json:"driver_paths"`
	CustomISOName string   `json:"custom_iso_name"`
}

func NewBuildHandler(db *gorm.DB, client *asynq.Client, buildMode string) *BuildHandler {
	return &BuildHandler{
		db:         db,
		taskClient: client,
		buildMode:  normalizeBuildMode(buildMode),
		workDir:    "./data/builds",
		preflights: make(map[string]*BuildPreflight),
	}
}

func (h *BuildHandler) SetWorkDir(workDir string) {
	if strings.TrimSpace(workDir) != "" {
		h.workDir = workDir
	}
}

func (h *BuildHandler) Create(c *fiber.Ctx) error {
	if h.taskClient == nil && h.buildMode != "external" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(utils.ErrorResponse("task queue is not configured"))
	}

	var req createBuildRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("invalid request body"))
	}
	if err := validateCreateBuildRequest(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	driversJSON, err := json.Marshal(req.DriverPaths)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	buildTask := models.BuildTask{
		TaskID:          uuid.New().String(),
		Status:          models.BuildTaskStatusPending,
		StorageBucketID: req.BucketID,
		ESXiVersion:     req.ESXiVersion,
		DepotPath:       req.DepotPath,
		Drivers:         string(driversJSON),
		CustomISOName:   req.CustomISOName,
		Progress:        0,
	}

	if err := h.db.WithContext(c.UserContext()).Create(&buildTask).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	if h.buildMode == "external" {
		return c.Status(fiber.StatusCreated).JSON(utils.SuccessResponse(buildTask))
	}

	task, err := taskqueue.NewBuildISOTask(&taskqueue.BuildISOPayload{
		TaskID:        buildTask.TaskID,
		BucketID:      req.BucketID,
		DepotPath:     req.DepotPath,
		DriverPaths:   req.DriverPaths,
		ESXiVersion:   req.ESXiVersion,
		CustomISOName: req.CustomISOName,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	if _, err := h.taskClient.EnqueueContext(c.UserContext(), task, asynq.Queue("default")); err != nil {
		_ = h.db.WithContext(c.UserContext()).Model(&models.BuildTask{}).
			Where("task_id = ?", buildTask.TaskID).
			Updates(map[string]any{"status": models.BuildTaskStatusFailed, "error_message": err.Error()}).Error
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.Status(fiber.StatusCreated).JSON(utils.SuccessResponse(buildTask))
}

func normalizeBuildMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "external":
		return "external"
	default:
		return "local"
	}
}

func (h *BuildHandler) List(c *fiber.Ctx) error {
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 20)
	if pageSize > 100 {
		pageSize = 100
	}

	var tasks []models.BuildTask
	query := h.db.WithContext(c.UserContext()).Model(&models.BuildTask{})

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	if err := h.db.WithContext(c.UserContext()).
		Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&tasks).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(fiber.Map{
		"items":     tasks,
		"page":      page,
		"page_size": pageSize,
		"total":     total,
	}))
}

func (h *BuildHandler) Get(c *fiber.Ctx) error {
	taskID := c.Params("id")

	var task models.BuildTask
	if err := h.db.WithContext(c.UserContext()).Where("task_id = ?", taskID).First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(utils.ErrorResponse("build task not found"))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(task))
}

func (h *BuildHandler) Delete(c *fiber.Ctx) error {
	identifier := strings.TrimSpace(c.Params("id"))
	if identifier == "" {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("build task id is required"))
	}

	var task models.BuildTask
	query := h.db.WithContext(c.UserContext()).Where("task_id = ?", identifier)
	if numericID, err := strconv.ParseUint(identifier, 10, 64); err == nil {
		query = h.db.WithContext(c.UserContext()).Where("task_id = ? OR id = ?", identifier, numericID)
	}
	if err := query.First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(utils.ErrorResponse("build task not found"))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	if err := h.db.WithContext(c.UserContext()).Delete(&task).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(fiber.Map{"deleted": true, "task_id": task.TaskID}))
}

func (h *BuildHandler) GetLogs(c *fiber.Ctx) error {
	taskID := c.Params("id")

	var task models.BuildTask
	if err := h.db.WithContext(c.UserContext()).Select("log_output").Where("task_id = ?", taskID).First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(utils.ErrorResponse("build task not found"))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	c.Type("txt", "utf-8")
	return c.SendString(task.LogOutput)
}

func (h *BuildHandler) DownloadArtifact(c *fiber.Ctx) error {
	taskID := c.Params("id")

	var task models.BuildTask
	if err := h.db.WithContext(c.UserContext()).Where("task_id = ?", taskID).First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(utils.ErrorResponse("build task not found"))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	if task.Status != models.BuildTaskStatusCompleted || strings.TrimSpace(task.OutputISO) == "" {
		return c.Status(fiber.StatusConflict).JSON(utils.ErrorResponse("build artifact is not available"))
	}

	reader, err := h.openArtifact(c.UserContext(), task.StorageBucketID, task.OutputISO)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	filename := path.Base(strings.ReplaceAll(task.OutputISO, "\\", "/"))
	if filename == "." || filename == "/" || filename == "" {
		filename = "artifact.iso"
	}
	c.Set(fiber.HeaderContentType, "application/x-iso9660-image")
	c.Set(fiber.HeaderContentDisposition, fmt.Sprintf(`attachment; filename="%s"`, strings.ReplaceAll(filename, `"`, "")))
	if task.OutputISOSize > 0 {
		return c.SendStream(reader, int(task.OutputISOSize))
	}
	return c.SendStream(reader)
}

func (h *BuildHandler) openArtifact(ctx context.Context, bucketID uint, objectPath string) (io.ReadCloser, error) {
	var bucket models.StorageBucket
	if err := h.db.WithContext(ctx).First(&bucket, bucketID).Error; err != nil {
		return nil, fmt.Errorf("find storage bucket: %w", err)
	}

	switch strings.ToLower(strings.TrimSpace(bucket.Type)) {
	case "", models.StorageTypeS3:
		client, err := storage.NewS3Client(&storage.S3Config{
			Endpoint:        bucket.Endpoint,
			AccessKeyID:     bucket.AccessKey,
			SecretAccessKey: bucket.SecretKey,
			BucketName:      bucket.BucketName,
			Region:          bucket.Region,
			UseSSL:          bucket.UseSSL,
			PublicDomain:    bucket.PublicDomain,
		})
		if err != nil {
			return nil, err
		}
		return client.Download(ctx, objectPath)
	case models.StorageTypeLocal:
		store, err := storage.NewLocalStore(bucket.LocalPath)
		if err != nil {
			return nil, err
		}
		return store.Download(ctx, objectPath)
	default:
		return nil, fmt.Errorf("unsupported storage bucket type: %s", bucket.Type)
	}
}

func parsePositiveInt(value string, fallback int) int {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func validateCreateBuildRequest(req *createBuildRequest) error {
	if req == nil {
		return fmt.Errorf("request body is required")
	}
	if req.BucketID == 0 {
		return fmt.Errorf("bucket_id is required")
	}
	req.ESXiVersion = strings.TrimSpace(req.ESXiVersion)
	if req.ESXiVersion == "" {
		return fmt.Errorf("esxi_version is required")
	}
	req.DepotPath = strings.TrimSpace(req.DepotPath)
	if req.DepotPath == "" {
		return fmt.Errorf("depot_path is required")
	}
	for i, driverPath := range req.DriverPaths {
		req.DriverPaths[i] = strings.TrimSpace(driverPath)
	}
	req.CustomISOName = strings.TrimSpace(req.CustomISOName)
	return nil
}
