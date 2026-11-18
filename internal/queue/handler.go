package queue

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	"gorm.io/gorm/clause"

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

func NewBuildTaskHandler(db *gorm.DB, executor *builder.PowerShellExecutor, workDir string, wsManager *ws.Manager) *BuildTaskHandler {
	return &BuildTaskHandler{
		db:        db,
		executor:  executor,
		workDir:   workDir,
		wsManager: wsManager,
	}
}

func (h *BuildTaskHandler) HandleBuildISO(ctx context.Context, task *asynq.Task) (resultErr error) {
	if h.executor == nil {
		return fmt.Errorf("powershell executor is not configured")
	}

	var payload BuildISOPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("unmarshal build payload: %w", err)
	}

	defer func() {
		if resultErr == nil {
			return
		}
		persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		if err := h.updateError(persistCtx, payload.TaskID, resultErr.Error()); err != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("persist failed task: %w", err))
		}
	}()

	startedAt := time.Now()
	if err := h.db.WithContext(ctx).Model(&models.BuildTask{}).Where("task_id = ?", payload.TaskID).Updates(map[string]any{
		"status":     models.BuildTaskStatusRunning,
		"progress":   0,
		"started_at": startedAt,
	}).Error; err != nil {
		return fmt.Errorf("mark build task as running: %w", err)
	}

	inputStarted := time.Now()
	taskWorkDir := filepath.Join(h.workDir, payload.TaskID)
	defer os.RemoveAll(taskWorkDir)

	if err := os.MkdirAll(taskWorkDir, 0o755); err != nil {
		return fmt.Errorf("create task work directory: %w", err)
	}

	buildStore, err := h.resolveStorage(ctx, payload.BucketID)
	if err != nil {
		return err
	}

	depotLocal, err := buildStore.EnsureFile(ctx, payload.DepotPath)
	if err != nil {
		return fmt.Errorf("cache depot: %w", err)
	}
	if err := ValidateBuildInputFile(depotLocal, payload.DepotPath); err != nil {
		return err
	}

	driverLocals := make([]string, 0, len(payload.DriverPaths))
	for _, driverPath := range payload.DriverPaths {
		localPath, err := buildStore.EnsureFile(ctx, driverPath)
		if err != nil {
			return fmt.Errorf("cache driver %s: %w", driverPath, err)
		}
		if err := ValidateBuildInputFile(localPath, driverPath); err != nil {
			return err
		}
		driverLocals = append(driverLocals, localPath)
	}

	outputFileName := BuildOutputFileName(payload.CustomISOName, payload.ESXiVersion)
	outputLocalPath := filepath.Join(taskWorkDir, outputFileName)

	progressChan := make(chan builder.BuildProgress, 32)
	progressChan <- builder.BuildProgress{Percentage: -1, Message: fmt.Sprintf("[TIMING] input_prepare_ms=%d", time.Since(inputStarted).Milliseconds())}
	var progressErr error
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		progressErr = h.consumeProgress(ctx, payload.TaskID, progressChan)
	}()
	powerCLIStarted := time.Now()
	err = h.executor.ExecuteBuild(ctx, &builder.BuildParams{
		DepotPath:    depotLocal,
		DriverPaths:  driverLocals,
		OutputPath:   outputLocalPath,
		ESXiVersion:  payload.ESXiVersion,
		WorkDir:      taskWorkDir,
		ImageProfile: payload.ImageProfile,
		RootPassword: payload.RootPassword,
		InstallMode:  payload.InstallMode,
		BootOptions:  payload.BootOptions,
	}, progressChan)
	powerCLIDuration := time.Since(powerCLIStarted)
	wg.Wait()
	if err == nil {
		err = progressErr
	}
	if err != nil {
		return err
	}

	persistStarted := time.Now()
	outputBucket, outputStore, err := h.resolveOutputStorage(ctx, payload)
	if err != nil {
		return err
	}
	outputObjectPath, shaValue, outputSize, err := storeBuildOutput(ctx, outputStore, outputLocalPath, outputFileName)
	if err != nil {
		return err
	}
	// Clean up temporary local build artifact immediately after upload succeeds.
	_ = os.Remove(outputLocalPath)

	completedAt := time.Now()
	h.upsertOutputMetadata(ctx, outputBucket.ID, outputObjectPath, payload.ESXiVersion, outputFileName, shaValue, outputSize, completedAt)

	isS3Output := models.NormalizeStorageType(outputBucket.Type) == models.StorageTypeS3
	if isS3Output {
		h.cleanupLocalGeneratedISO(ctx, outputObjectPath)
	}

	extraArchiveLog := ""
	if isS3Output {
		extraArchiveLog = fmt.Sprintf("ISO archived to S3 (%s: %s) and local generated ISO cleaned\n", outputBucket.Name, outputObjectPath)
	}

	updates := map[string]any{
		"status":            models.BuildTaskStatusCompleted,
		"progress":          100,
		"storage_bucket_id": outputBucket.ID,
		"output_iso":        outputObjectPath,
		"output_iso_sha256": shaValue,
		"output_iso_size":   outputSize,
		"completed_at":      completedAt,
		"build_duration":    int(completedAt.Sub(startedAt).Seconds()),
		"error_message":     "",
		"log_output":        gorm.Expr("COALESCE(log_output, '') || ?", fmt.Sprintf("[TIMING] powercli_process_ms=%d\n[TIMING] artifact_persist_ms=%d\nISO uploaded to %s\n%s", powerCLIDuration.Milliseconds(), time.Since(persistStarted).Milliseconds(), outputObjectPath, extraArchiveLog)),
	}
	if err := h.db.WithContext(ctx).Model(&models.BuildTask{}).Where("task_id = ?", payload.TaskID).Updates(updates).Error; err != nil {
		return fmt.Errorf("finalize build task: %w", err)
	}

	if h.wsManager != nil {
		h.wsManager.BroadcastLog(payload.TaskID, fmt.Sprintf("ISO uploaded to %s", outputObjectPath))
		if extraArchiveLog != "" {
			h.wsManager.BroadcastLog(payload.TaskID, strings.TrimSpace(extraArchiveLog))
		}
		h.wsManager.BroadcastProgress(payload.TaskID, 100)
	}

	return nil
}

func (h *BuildTaskHandler) appendLog(ctx context.Context, taskID string, msg string) error {
	return h.db.WithContext(ctx).Model(&models.BuildTask{}).
		Where("task_id = ?", taskID).
		Update("log_output", gorm.Expr("COALESCE(log_output, '') || ?", msg+"\n")).Error
}

func (h *BuildTaskHandler) updateStatus(ctx context.Context, taskID string, status string, progress int) error {
	return h.db.WithContext(ctx).Model(&models.BuildTask{}).
		Where("task_id = ?", taskID).
		Updates(map[string]any{"status": status, "progress": progress}).Error
}

func (h *BuildTaskHandler) updateError(ctx context.Context, taskID string, errMsg string) error {
	now := time.Now()
	return h.db.WithContext(ctx).Model(&models.BuildTask{}).
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
	return h.resolveBucketStorage(bucket)
}

func (h *BuildTaskHandler) resolveBucketStorage(bucket models.StorageBucket) (buildStorage, error) {
	if models.NormalizeStorageType(bucket.Type) == models.StorageTypeLocal {
		return newLocalBuildStorage(bucket.LocalPath)
	}
	if bucket.Type != "" && models.NormalizeStorageType(bucket.Type) != models.StorageTypeS3 {
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

// resolveOutputStorage chooses the bucket where generated ISOs are persisted.
// When ArchiveToS3 is enabled (or not explicitly disabled and an S3 bucket is mounted),
// generated ISOs are uploaded directly to S3 so local generated copies can be cleaned up.
func (h *BuildTaskHandler) resolveOutputStorage(ctx context.Context, payload BuildISOPayload) (models.StorageBucket, buildStorage, error) {
	if payload.TargetBucketID > 0 {
		var target models.StorageBucket
		if err := h.db.WithContext(ctx).First(&target, payload.TargetBucketID).Error; err == nil {
			store, sErr := h.resolveBucketStorage(target)
			if sErr == nil {
				return target, store, nil
			}
		}
	}

	var sourceBucket models.StorageBucket
	if err := h.db.WithContext(ctx).First(&sourceBucket, payload.BucketID).Error; err != nil {
		return models.StorageBucket{}, buildStorage{}, fmt.Errorf("find storage bucket: %w", err)
	}

	shouldTryS3 := models.NormalizeStorageType(sourceBucket.Type) == models.StorageTypeLocal &&
		(payload.ArchiveToS3 == nil || *payload.ArchiveToS3)
	if shouldTryS3 {
		var s3Bucket models.StorageBucket
		err := h.db.WithContext(ctx).
			Where("type = ? OR type = ''", models.StorageTypeS3).
			Order("is_default DESC, id ASC").
			First(&s3Bucket).Error
		if err == nil {
			if s3Store, sErr := h.resolveBucketStorage(s3Bucket); sErr == nil {
				return s3Bucket, s3Store, nil
			}
		}
	}

	store, err := h.resolveBucketStorage(sourceBucket)
	if err != nil {
		return models.StorageBucket{}, buildStorage{}, err
	}
	return sourceBucket, store, nil
}

func (h *BuildTaskHandler) upsertOutputMetadata(ctx context.Context, bucketID uint, objectPath, esxiVersion, outputFileName, shaValue string, size int64, completedAt time.Time) {
	if !h.db.Migrator().HasTable(&models.FileMetadata{}) {
		return
	}
	baseName := strings.TrimSuffix(outputFileName, filepath.Ext(outputFileName))
	meta := models.FileMetadata{
		StorageBucketID:   bucketID,
		Path:              objectPath,
		Type:              models.FileTypeISO,
		ESXiVersion:       esxiVersion,
		DriverName:        baseName,
		DriverVersion:     baseName,
		DriverDescription: "ISO镜像",
		SHA256:            shaValue,
		Size:              size,
		LastModified:      &completedAt,
	}
	_ = h.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "storage_bucket_id"}, {Name: "path"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"deleted_at",
			"type",
			"esxi_version",
			"driver_name",
			"driver_description",
			"driver_version",
			"sha256",
			"size",
			"last_modified",
			"updated_at",
		}),
	}).Create(&meta).Error
}

func (h *BuildTaskHandler) cleanupLocalGeneratedISO(ctx context.Context, objectPath string) {
	var localBuckets []models.StorageBucket
	if err := h.db.WithContext(ctx).Where("type = ?", models.StorageTypeLocal).Find(&localBuckets).Error; err != nil {
		return
	}
	baseName := path.Base(strings.ReplaceAll(objectPath, "\\", "/"))
	candidatePaths := []string{objectPath}
	for _, pfx := range []string{"build", "output"} {
		alt := path.Join(pfx, baseName)
		if alt != objectPath {
			candidatePaths = append(candidatePaths, alt)
		}
	}
	for _, lb := range localBuckets {
		if store, err := storage.NewLocalStore(lb.LocalPath); err == nil {
			for _, p := range candidatePaths {
				_ = store.DeleteObject(ctx, p)
			}
		}
		if h.db.Migrator().HasTable(&models.FileMetadata{}) {
			_ = h.db.WithContext(ctx).Unscoped().
				Where("storage_bucket_id = ? AND path IN ?", lb.ID, candidatePaths).
				Delete(&models.FileMetadata{}).Error
		}
	}
}

func newLocalBuildStorage(localPath string) (buildStorage, error) {
	store, err := storage.NewLocalStore(localPath)
	if err != nil {
		return buildStorage{}, err
	}
	return buildStorage{resolver: store, uploader: store}, nil
}

func ValidateBuildInputFile(localPath, objectPath string) error {
	ext := strings.ToLower(filepath.Ext(objectPath))
	if ext != ".zip" && ext != ".vib" && ext != ".iso" {
		return fmt.Errorf("unsupported build input: %s", objectPath)
	}

	file, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open build input %s: %w", objectPath, err)
	}
	defer file.Close()

	if ext == ".iso" {
		signature := make([]byte, 5)
		if _, err := file.ReadAt(signature, 32769); err != nil {
			return fmt.Errorf("read ISO signature: %w", err)
		}
		if string(signature) != "CD001" {
			return fmt.Errorf("输入不是有效 ISO9660 镜像: %s", objectPath)
		}
		return nil
	}
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

	outputObjectPath := path.Join("build", outputFileName)
	hasher := sha256.New()
	if err := store.Upload(ctx, outputObjectPath, io.TeeReader(outputFile, hasher), outputInfo.Size(), "application/x-iso9660-image"); err != nil {
		return "", "", 0, fmt.Errorf("upload output iso: %w", err)
	}

	return outputObjectPath, hex.EncodeToString(hasher.Sum(nil)), outputInfo.Size(), nil
}
