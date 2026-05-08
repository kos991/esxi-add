package queue

import (
	"bytes"
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
	db        *gorm.DB
	executor  *builder.PowerShellExecutor
	workDir   string
	wsManager *ws.Manager
}

var newBuildS3Client = storage.NewS3Client

type fileResolver interface {
	EnsureFile(ctx context.Context, objectPath string) (string, error)
}

type objectUploader interface {
	Upload(ctx context.Context, objectPath string, reader io.Reader, size int64, contentType string) error
}

type buildStorage struct {
	resolver fileResolver
	uploader objectUploader
}

func (s buildStorage) EnsureFile(ctx context.Context, objectPath string) (string, error) {
	return s.resolver.EnsureFile(ctx, objectPath)
}

func (s buildStorage) Upload(ctx context.Context, objectPath string, reader io.Reader, size int64, contentType string) error {
	return s.uploader.Upload(ctx, objectPath, reader, size, contentType)
}

func NewBuildTaskHandler(db *gorm.DB, executor *builder.PowerShellExecutor, _ *storage.CacheManager, _ *storage.S3Client, workDir string, wsManager *ws.Manager) *BuildTaskHandler {
	return &BuildTaskHandler{
		db:        db,
		executor:  executor,
		workDir:   workDir,
		wsManager: wsManager,
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

	buildStore, err := h.resolveStorage(ctx, payload.BucketID)
	if err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return err
	}

	depotLocal, err := buildStore.EnsureFile(ctx, payload.DepotPath)
	if err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return fmt.Errorf("cache depot: %w", err)
	}
	if err := validateBuildInputFile(depotLocal, payload.DepotPath); err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return err
	}

	driverLocals := make([]string, 0, len(payload.DriverPaths))
	for _, driverPath := range payload.DriverPaths {
		localPath, err := buildStore.EnsureFile(ctx, driverPath)
		if err != nil {
			_ = h.updateError(payload.TaskID, err.Error())
			return fmt.Errorf("cache driver %s: %w", driverPath, err)
		}
		if err := validateBuildInputFile(localPath, driverPath); err != nil {
			_ = h.updateError(payload.TaskID, err.Error())
			return err
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

	outputObjectPath, shaValue, outputSize, err := storeBuildOutput(ctx, buildStore, outputLocalPath, outputFileName)
	if err != nil {
		_ = h.updateError(payload.TaskID, err.Error())
		return err
	}

	completedAt := time.Now()
	updates := map[string]any{
		"status":            models.BuildTaskStatusCompleted,
		"progress":          100,
		"output_iso":        outputObjectPath,
		"output_iso_sha256": shaValue,
		"output_iso_size":   outputSize,
		"completed_at":      completedAt,
		"build_duration":    int(completedAt.Sub(startedAt).Seconds()),
		"error_message":     "",
	}
	if err := h.db.WithContext(ctx).Model(&models.BuildTask{}).Where("task_id = ?", payload.TaskID).Updates(updates).Error; err != nil {
		return fmt.Errorf("finalize build task: %w", err)
	}

	_ = h.appendLog(payload.TaskID, fmt.Sprintf("ISO uploaded to %s", outputObjectPath))
	if h.wsManager != nil {
		h.wsManager.BroadcastLog(payload.TaskID, fmt.Sprintf("ISO uploaded to %s", outputObjectPath))
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

func (h *BuildTaskHandler) resolveStorage(ctx context.Context, bucketID uint) (buildStorage, error) {
	var bucket models.StorageBucket
	if err := h.db.WithContext(ctx).First(&bucket, bucketID).Error; err != nil {
		return buildStorage{}, fmt.Errorf("find storage bucket: %w", err)
	}

	if bucket.Type == models.StorageTypeLocal {
		return newLocalBuildStorage(bucket.LocalPath)
	}
	if bucket.Type != "" && bucket.Type != models.StorageTypeS3 {
		return buildStorage{}, fmt.Errorf("unsupported storage bucket type: %s", bucket.Type)
	}

	client, err := newBuildS3Client(&storage.S3Config{
		Endpoint:        bucket.Endpoint,
		AccessKeyID:     bucket.AccessKey,
		SecretAccessKey: bucket.SecretKey,
		BucketName:      bucket.BucketName,
		Region:          bucket.Region,
		UseSSL:          bucket.UseSSL,
		PublicDomain:    bucket.PublicDomain,
	})
	if err != nil {
		return buildStorage{}, err
	}

	cacheManager := storage.NewCacheManager(filepath.Join(h.workDir, "cache", fmt.Sprintf("bucket-%d", bucket.ID)), client)
	return buildStorage{resolver: cacheManager, uploader: client}, nil
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

func newLocalBuildStorage(localPath string) (buildStorage, error) {
	store, err := storage.NewLocalStore(localPath)
	if err != nil {
		return buildStorage{}, err
	}
	return buildStorage{resolver: store, uploader: store}, nil
}

func validateBuildInputFile(localPath, objectPath string) error {
	ext := strings.ToLower(filepath.Ext(objectPath))
	if ext != ".zip" && ext != ".vib" {
		return nil
	}

	file, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open build input %s: %w", objectPath, err)
	}
	defer file.Close()

	header := make([]byte, 8)
	n, err := io.ReadFull(file, header)
	if err != nil && err != io.ErrUnexpectedEOF {
		return fmt.Errorf("read build input %s: %w", objectPath, err)
	}
	header = header[:n]

	switch ext {
	case ".zip":
		if bytes.HasPrefix(header, []byte("PK\x03\x04")) ||
			bytes.HasPrefix(header, []byte("PK\x05\x06")) ||
			bytes.HasPrefix(header, []byte("PK\x07\x08")) {
			return nil
		}
	case ".vib":
		if bytes.HasPrefix(header, []byte("!<arch>\n")) {
			return nil
		}
	}

	return fmt.Errorf("build input %s is not a valid %s file; re-upload or refresh the cached object", objectPath, ext)
}

func storeBuildOutput(ctx context.Context, store buildStorage, outputLocalPath, outputFileName string) (string, string, int64, error) {
	outputFile, err := os.Open(outputLocalPath)
	if err != nil {
		return "", "", 0, fmt.Errorf("open output iso: %w", err)
	}
	defer outputFile.Close()

	outputInfo, err := outputFile.Stat()
	if err != nil {
		return "", "", 0, fmt.Errorf("stat output iso: %w", err)
	}

	outputObjectPath := path.Join("output", outputFileName)
	hasher := sha256.New()
	if err := store.Upload(ctx, outputObjectPath, io.TeeReader(outputFile, hasher), outputInfo.Size(), "application/x-iso9660-image"); err != nil {
		return "", "", 0, fmt.Errorf("upload output iso: %w", err)
	}

	return outputObjectPath, hex.EncodeToString(hasher.Sum(nil)), outputInfo.Size(), nil
}
