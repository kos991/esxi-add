package handlers

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	taskqueue "github.com/esxi-builder/esxi-iso-builder/internal/queue"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
	"github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

type WorkerHandler struct {
	db          *gorm.DB
	workerToken string
}

type workerClaimResponse struct {
	TaskID        string   `json:"task_id"`
	BucketID      uint     `json:"bucket_id"`
	ESXiVersion   string   `json:"esxi_version"`
	DepotPath     string   `json:"depot_path"`
	DriverPaths   []string `json:"driver_paths"`
	CustomISOName string   `json:"custom_iso_name"`
	OutputISOName string   `json:"output_iso_name"`
}

type workerProgressRequest struct {
	Progress     *int   `json:"progress"`
	Log          string `json:"log"`
	Status       string `json:"status"`
	ErrorMessage string `json:"error_message"`
}

type objectStore interface {
	Download(ctx context.Context, objectName string) (io.ReadCloser, error)
	Upload(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) error
}

func NewWorkerHandler(db *gorm.DB, workerToken string) *WorkerHandler {
	return &WorkerHandler{db: db, workerToken: strings.TrimSpace(workerToken)}
}

func (h *WorkerHandler) ClaimBuild(c *fiber.Ctx) error {
	if err := h.authorize(c); err != nil {
		return err
	}

	var claimed *models.BuildTask
	err := h.db.WithContext(c.UserContext()).Transaction(func(tx *gorm.DB) error {
		var task models.BuildTask
		if err := tx.Where("status = ?", models.BuildTaskStatusPending).Order("created_at ASC").First(&task).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}

		now := time.Now()
		result := tx.Model(&models.BuildTask{}).
			Where("id = ? AND status = ?", task.ID, models.BuildTaskStatusPending).
			Updates(map[string]any{
				"status":        models.BuildTaskStatusRunning,
				"progress":      0,
				"started_at":    now,
				"error_message": "",
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		task.Status = models.BuildTaskStatusRunning
		task.Progress = 0
		task.StartedAt = &now
		claimed = &task
		return nil
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}
	if claimed == nil {
		return c.JSON(utils.SuccessResponse(nil))
	}

	driverPaths, err := parseDriverPaths(claimed.Drivers)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(workerClaimResponse{
		TaskID:        claimed.TaskID,
		BucketID:      claimed.StorageBucketID,
		ESXiVersion:   claimed.ESXiVersion,
		DepotPath:     claimed.DepotPath,
		DriverPaths:   driverPaths,
		CustomISOName: claimed.CustomISOName,
		OutputISOName: taskqueue.BuildOutputFileName(claimed.CustomISOName, claimed.ESXiVersion),
	}))
}

func (h *WorkerHandler) DownloadFile(c *fiber.Ctx) error {
	if err := h.authorize(c); err != nil {
		return err
	}

	bucketID, err := strconvQueryUint(c, "bucket_id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}
	objectPath := strings.TrimSpace(c.Query("path"))
	if objectPath == "" {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("path is required"))
	}

	store, err := h.objectStore(c.UserContext(), bucketID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}
	reader, err := store.Download(c.UserContext(), objectPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	name := path.Base(objectPath)
	c.Set(fiber.HeaderContentDisposition, fmt.Sprintf("attachment; filename=%q", name))
	c.Set(fiber.HeaderContentType, contentTypeFromName(name))
	return c.SendStream(reader)
}

func (h *WorkerHandler) UpdateProgress(c *fiber.Ctx) error {
	if err := h.authorize(c); err != nil {
		return err
	}

	taskID := c.Params("id")
	var req workerProgressRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("invalid request body"))
	}

	if strings.TrimSpace(req.Log) != "" {
		if err := h.appendLog(c.UserContext(), taskID, strings.TrimSpace(req.Log)); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
		}
	}

	updates := map[string]any{}
	if req.Progress != nil {
		progress := *req.Progress
		if progress < 0 {
			progress = 0
		}
		if progress > 100 {
			progress = 100
		}
		updates["progress"] = progress
	}
	switch strings.ToLower(strings.TrimSpace(req.Status)) {
	case "", models.BuildTaskStatusRunning:
		if len(updates) > 0 {
			updates["status"] = models.BuildTaskStatusRunning
		}
	case models.BuildTaskStatusFailed:
		updates["status"] = models.BuildTaskStatusFailed
		updates["error_message"] = strings.TrimSpace(req.ErrorMessage)
		now := time.Now()
		updates["completed_at"] = now
	default:
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("unsupported worker status"))
	}

	if len(updates) > 0 {
		if err := h.db.WithContext(c.UserContext()).Model(&models.BuildTask{}).Where("task_id = ?", taskID).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
		}
	}
	return c.JSON(utils.SuccessResponse(fiber.Map{"updated": true}))
}

func (h *WorkerHandler) UploadArtifact(c *fiber.Ctx) error {
	if err := h.authorize(c); err != nil {
		return err
	}

	taskID := c.Params("id")
	var task models.BuildTask
	if err := h.db.WithContext(c.UserContext()).Where("task_id = ?", taskID).First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(utils.ErrorResponse("build task not found"))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("file is required"))
	}
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}
	defer file.Close()

	store, err := h.objectStore(c.UserContext(), task.StorageBucketID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	outputName := taskqueue.BuildOutputFileName(task.CustomISOName, task.ESXiVersion)
	outputObjectPath := path.Join("output", outputName)
	hasher := sha256.New()
	if err := store.Upload(c.UserContext(), outputObjectPath, io.TeeReader(file, hasher), fileHeader.Size, contentTypeFromName(outputName)); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	now := time.Now()
	updates := map[string]any{
		"status":            models.BuildTaskStatusCompleted,
		"progress":          100,
		"output_iso":        outputObjectPath,
		"output_iso_size":   fileHeader.Size,
		"output_iso_sha256": hex.EncodeToString(hasher.Sum(nil)),
		"completed_at":      now,
		"error_message":     "",
	}
	if task.StartedAt != nil {
		updates["build_duration"] = int(now.Sub(*task.StartedAt).Seconds())
	}
	if err := h.db.WithContext(c.UserContext()).Model(&models.BuildTask{}).Where("task_id = ?", taskID).Updates(updates).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}
	_ = h.appendLog(c.UserContext(), taskID, fmt.Sprintf("ISO uploaded to %s", outputObjectPath))

	return c.JSON(utils.SuccessResponse(fiber.Map{
		"output_iso":        outputObjectPath,
		"output_iso_size":   fileHeader.Size,
		"output_iso_sha256": updates["output_iso_sha256"],
	}))
}

func (h *WorkerHandler) authorize(c *fiber.Ctx) error {
	if h.workerToken == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(utils.ErrorResponse("worker token is not configured"))
	}
	token := strings.TrimSpace(c.Get("X-Worker-Token"))
	if len(token) != len(h.workerToken) || subtle.ConstantTimeCompare([]byte(token), []byte(h.workerToken)) != 1 {
		return c.Status(fiber.StatusUnauthorized).JSON(utils.ErrorResponse("invalid worker token"))
	}
	return nil
}

func (h *WorkerHandler) objectStore(ctx context.Context, bucketID uint) (objectStore, error) {
	var bucket models.StorageBucket
	if err := h.db.WithContext(ctx).First(&bucket, bucketID).Error; err != nil {
		return nil, fmt.Errorf("find storage bucket: %w", err)
	}
	switch models.NormalizeStorageType(bucket.Type) {
	case models.StorageTypeLocal:
		return storage.NewLocalStore(bucket.LocalPath)
	case models.StorageTypeS3:
		return storage.NewS3Client(&storage.S3Config{
			Endpoint:        bucket.Endpoint,
			AccessKeyID:     bucket.AccessKey,
			SecretAccessKey: bucket.SecretKey,
			BucketName:      bucket.BucketName,
			Region:          bucket.Region,
			UseSSL:          bucket.UseSSL,
			PublicDomain:    bucket.PublicDomain,
		})
	default:
		return nil, fmt.Errorf("unsupported storage bucket type: %s", bucket.Type)
	}
}

func (h *WorkerHandler) appendLog(ctx context.Context, taskID, msg string) error {
	return h.db.WithContext(ctx).Model(&models.BuildTask{}).
		Where("task_id = ?", taskID).
		Update("log_output", gorm.Expr("COALESCE(log_output, '') || ?", msg+"\n")).Error
}

func parseDriverPaths(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return []string{}, nil
	}
	var paths []string
	if err := json.Unmarshal([]byte(raw), &paths); err != nil {
		return nil, fmt.Errorf("parse driver paths: %w", err)
	}
	return paths, nil
}

func contentTypeFromName(name string) string {
	if strings.EqualFold(filepath.Ext(name), ".iso") {
		return "application/x-iso9660-image"
	}
	if contentType := mime.TypeByExtension(filepath.Ext(name)); contentType != "" {
		return contentType
	}
	return "application/octet-stream"
}

func strconvQueryUint(c *fiber.Ctx, name string) (uint, error) {
	value := strings.TrimSpace(c.Query(name))
	if value == "" {
		return 0, fmt.Errorf("%s is required", name)
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil || parsed == 0 {
		return 0, fmt.Errorf("invalid %s", name)
	}
	return uint(parsed), nil
}
