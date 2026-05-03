package queue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/builder"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
	ws "github.com/esxi-builder/esxi-iso-builder/internal/websocket"
)

type BuildTaskHandler struct {
	db           *gorm.DB
	executor     *builder.PowerShellExecutor
	cacheManager *storage.CacheManager
	s3Client     *storage.S3Client
	workDir      string
	wsManager    *ws.Manager
}

func NewBuildTaskHandler(db *gorm.DB, executor *builder.PowerShellExecutor, cacheManager *storage.CacheManager, s3Client *storage.S3Client, workDir string, wsManager *ws.Manager) *BuildTaskHandler {
	return &BuildTaskHandler{
		db:           db,
		executor:     executor,
		cacheManager: cacheManager,
		s3Client:     s3Client,
		workDir:      workDir,
		wsManager:    wsManager,
	}
}

func (h *BuildTaskHandler) HandleBuildISO(ctx context.Context, task *asynq.Task) error {
	if h.executor == nil {
		return fmt.Errorf("powershell executor is not configured")
	}

	var payload BuildISOPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("unmarshal build payload: %w", err)
	}

	startedAt := time.Now()
	if err := h.db.WithContext(ctx).Model(&models.BuildTask{}).Where("task_id = ?", payload.TaskID).Updates(map[string]any{
		"status":     models.BuildTaskStatusRunning,
		"progress":   0,
		"started_at": startedAt,
	}).Error; err != nil {
		return fmt.Errorf("mark build task as running: %w", err)
	}

	taskWorkDir := filepath.Join(h.workDir, payload.TaskID)
	defer os.RemoveAll(taskWorkDir)

	if err := os.MkdirAll(taskWorkDir, 0o755); err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return fmt.Errorf("create task work directory: %w", err)
	}

	client, cacheManager, err := h.resolveStorage(ctx, payload.BucketID)
	if err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return err
	}

	depotLocal, err := cacheManager.EnsureFile(ctx, payload.DepotPath)
	if err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return fmt.Errorf("cache depot: %w", err)
	}

	driverLocals := make([]string, 0, len(payload.DriverPaths))
	for _, driverPath := range payload.DriverPaths {
		localPath, err := cacheManager.EnsureFile(ctx, driverPath)
		if err != nil {
			_ = h.updateError(payload.TaskID, err.Error())
			return fmt.Errorf("cache driver %s: %w", driverPath, err)
		}
		driverLocals = append(driverLocals, localPath)
	}

	outputFileName := buildOutputFileName(payload.CustomISOName, payload.ESXiVersion)
	outputLocalPath := filepath.Join(taskWorkDir, outputFileName)

	progressChan := make(chan builder.BuildProgress, 32)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for progress := range progressChan {
			if progress.Message != "" {
				_ = h.appendLog(payload.TaskID, progress.Message)
				if h.wsManager != nil {
					h.wsManager.BroadcastLog(payload.TaskID, progress.Message)
				}
			}
			if progress.Percentage >= 0 {
				_ = h.updateStatus(payload.TaskID, models.BuildTaskStatusRunning, progress.Percentage)
				if h.wsManager != nil {
					h.wsManager.BroadcastProgress(payload.TaskID, progress.Percentage)
				}
			}
		}
	}()

	err = h.executor.ExecuteBuild(ctx, &builder.BuildParams{
		DepotPath:   depotLocal,
		DriverPaths: driverLocals,
		OutputPath:  outputLocalPath,
		ESXiVersion: payload.ESXiVersion,
		WorkDir:     taskWorkDir,
	}, progressChan)
	wg.Wait()
	if err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return err
	}

	outputFile, err := os.Open(outputLocalPath)
	if err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return fmt.Errorf("open output iso: %w", err)
	}
	defer outputFile.Close()

	outputInfo, err := outputFile.Stat()
	if err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return fmt.Errorf("stat output iso: %w", err)
	}

	outputS3Path := path.Join("output", outputFileName)
	hasher := sha256.New()
	if err := client.Upload(ctx, outputS3Path, io.TeeReader(outputFile, hasher), outputInfo.Size(), "application/x-iso9660-image"); err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return fmt.Errorf("upload output iso: %w", err)
	}

	completedAt := time.Now()
	shaValue := hex.EncodeToString(hasher.Sum(nil))
	updates := map[string]any{
		"status":            models.BuildTaskStatusCompleted,
		"progress":          100,
		"output_iso":        outputS3Path,
		"output_iso_sha256": shaValue,
		"output_iso_size":   outputInfo.Size(),
		"completed_at":      completedAt,
		"build_duration":    int(completedAt.Sub(startedAt).Seconds()),
		"error_message":     "",
	}
	if err := h.db.WithContext(ctx).Model(&models.BuildTask{}).Where("task_id = ?", payload.TaskID).Updates(updates).Error; err != nil {
		return fmt.Errorf("finalize build task: %w", err)
	}

	_ = h.appendLog(payload.TaskID, fmt.Sprintf("ISO uploaded to %s", outputS3Path))
	if h.wsManager != nil {
		h.wsManager.BroadcastLog(payload.TaskID, fmt.Sprintf("ISO uploaded to %s", outputS3Path))
		h.wsManager.BroadcastProgress(payload.TaskID, 100)
	}

	return nil
}

func (h *BuildTaskHandler) appendLog(taskID, msg string) error {
	return h.db.Model(&models.BuildTask{}).
		Where("task_id = ?", taskID).
		Update("log_output", gorm.Expr("COALESCE(log_output, '') || ?", msg+"\n")).Error
}

func (h *BuildTaskHandler) updateStatus(taskID, status string, progress int) error {
	return h.db.Model(&models.BuildTask{}).
		Where("task_id = ?", taskID).
		Updates(map[string]any{"status": status, "progress": progress}).Error
}

func (h *BuildTaskHandler) updateError(taskID, errMsg string) error {
	now := time.Now()
	return h.db.Model(&models.BuildTask{}).
		Where("task_id = ?", taskID).
		Updates(map[string]any{
			"status":        models.BuildTaskStatusFailed,
			"error_message": errMsg,
			"completed_at":  now,
		}).Error
}

func (h *BuildTaskHandler) resolveStorage(ctx context.Context, bucketID uint) (*storage.S3Client, *storage.CacheManager, error) {
	if h.s3Client != nil && h.cacheManager != nil {
		return h.s3Client, h.cacheManager, nil
	}

	var bucket models.StorageBucket
	if err := h.db.WithContext(ctx).First(&bucket, bucketID).Error; err != nil {
		return nil, nil, fmt.Errorf("find storage bucket: %w", err)
	}

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
		return nil, nil, err
	}

	cacheManager := h.cacheManager
	if cacheManager == nil {
		cacheManager = storage.NewCacheManager(filepath.Join(h.workDir, "cache"), client)
	}

	return client, cacheManager, nil
}

func buildOutputFileName(customISOName, esxiVersion string) string {
	if customISOName != "" {
		name := filepath.Base(strings.ReplaceAll(customISOName, "\\", "/"))
		if strings.EqualFold(filepath.Ext(name), ".iso") {
			return name
		}
		return name + ".iso"
	}

	return fmt.Sprintf("ESXi-%s-custom-%s.iso", esxiVersion, time.Now().Format("20060102-150405"))
}
