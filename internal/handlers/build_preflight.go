package handlers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/queue"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
	"github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

const (
	PreflightStatusRunning = "running"
	PreflightStatusReady   = "ready"
	PreflightStatusInvalid = "invalid"
	PreflightStatusFailed  = "failed"

	PreflightFileStatusPending     = "pending"
	PreflightFileStatusDownloading = "downloading"
	PreflightFileStatusValidating  = "validating"
	PreflightFileStatusReady       = "ready"
	PreflightFileStatusInvalid     = "invalid"
	PreflightFileStatusFailed      = "failed"
)

type BuildPreflight struct {
	ID        string          `json:"id"`
	Status    string          `json:"status"`
	Progress  int             `json:"progress"`
	Message   string          `json:"message,omitempty"`
	Files     []PreflightFile `json:"files"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type PreflightFile struct {
	Kind     string `json:"kind"`
	Path     string `json:"path"`
	Status   string `json:"status"`
	Progress int    `json:"progress"`
	Cached   bool   `json:"cached"`
	Size     int64  `json:"size,omitempty"`
	Message  string `json:"message,omitempty"`
}

type buildPreflightRequest struct {
	BucketID    uint     `json:"bucket_id"`
	DepotPath   string   `json:"depot_path"`
	DriverPaths []string `json:"driver_paths"`
}

func (h *BuildHandler) StartPreflight(c *fiber.Ctx) error {
	var req buildPreflightRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("invalid request body"))
	}
	if err := validateBuildPreflightRequest(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}
	if err := h.validatePreflightSelection(c.UserContext(), &req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	preflight := &BuildPreflight{
		ID:        uuid.New().String(),
		Status:    PreflightStatusRunning,
		Progress:  0,
		Files:     buildPreflightFiles(req.DepotPath, req.DriverPaths),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	h.setPreflight(preflight)

	ctx := context.WithoutCancel(c.UserContext())
	go h.runPreflight(ctx, preflight.ID, req)

	return c.Status(fiber.StatusAccepted).JSON(utils.SuccessResponse(preflight.clone()))
}

func (h *BuildHandler) GetPreflight(c *fiber.Ctx) error {
	id := strings.TrimSpace(c.Params("id"))
	preflight, ok := h.getPreflight(id)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(utils.ErrorResponse("build preflight not found"))
	}
	return c.JSON(utils.SuccessResponse(preflight))
}

func validateBuildPreflightRequest(req *buildPreflightRequest) error {
	if req == nil {
		return fmt.Errorf("request body is required")
	}
	if req.BucketID == 0 {
		return fmt.Errorf("bucket_id is required")
	}
	req.DepotPath = strings.TrimSpace(req.DepotPath)
	if req.DepotPath == "" {
		return fmt.Errorf("depot_path is required")
	}
	for i, driverPath := range req.DriverPaths {
		req.DriverPaths[i] = strings.TrimSpace(driverPath)
	}
	return nil
}

func (h *BuildHandler) validatePreflightSelection(ctx context.Context, req *buildPreflightRequest) error {
	if err := h.requireFileMetadata(ctx, req.BucketID, req.DepotPath, models.FileTypeDepot); err != nil {
		return err
	}
	for _, driverPath := range req.DriverPaths {
		if driverPath == "" {
			continue
		}
		if err := h.requireFileMetadata(ctx, req.BucketID, driverPath, models.FileTypeDriver); err != nil {
			return err
		}
	}
	return nil
}

func (h *BuildHandler) requireFileMetadata(ctx context.Context, bucketID uint, objectPath, fileType string) error {
	var file models.FileMetadata
	err := h.db.WithContext(ctx).
		Where("storage_bucket_id = ? AND path = ? AND type = ?", bucketID, objectPath, fileType).
		First(&file).Error
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("%s is not in the selected storage node file list", objectPath)
	}
	return fmt.Errorf("find selected file metadata: %w", err)
}

func buildPreflightFiles(depotPath string, driverPaths []string) []PreflightFile {
	files := make([]PreflightFile, 0, 1+len(driverPaths))
	files = append(files, PreflightFile{Kind: "depot", Path: depotPath, Status: PreflightFileStatusPending})
	for _, driverPath := range driverPaths {
		if strings.TrimSpace(driverPath) == "" {
			continue
		}
		files = append(files, PreflightFile{Kind: "driver", Path: strings.TrimSpace(driverPath), Status: PreflightFileStatusPending})
	}
	return files
}

func (h *BuildHandler) runPreflight(ctx context.Context, id string, req buildPreflightRequest) {
	resolver, err := h.preflightResolver(ctx, req.BucketID)
	if err != nil {
		h.finishPreflight(id, PreflightStatusFailed, err.Error())
		return
	}

	files := buildPreflightFiles(req.DepotPath, req.DriverPaths)
	for i, file := range files {
		h.updatePreflightFile(id, i, func(item *PreflightFile) {
			item.Status = PreflightFileStatusDownloading
			item.Progress = 0
			item.Message = "downloading"
		})

		localPath, err := resolver.EnsureFile(ctx, file.Path, func(progress storage.CacheProgress) {
			current := progress.Current
			total := progress.Total
			percent := 0
			if total > 0 {
				percent = int(current * 90 / total)
			}
			if percent > 90 {
				percent = 90
			}
			h.updatePreflightFile(id, i, func(item *PreflightFile) {
				item.Status = PreflightFileStatusDownloading
				item.Progress = percent
				item.Cached = progress.Cached
				item.Size = total
			})
		})
		if err != nil {
			h.updatePreflightFile(id, i, func(item *PreflightFile) {
				item.Status = PreflightFileStatusFailed
				item.Progress = 100
				item.Message = err.Error()
			})
			h.finishPreflight(id, PreflightStatusFailed, err.Error())
			return
		}

		h.updatePreflightFile(id, i, func(item *PreflightFile) {
			item.Status = PreflightFileStatusValidating
			item.Progress = 95
			item.Message = "validating archive format"
		})
		if err := queue.ValidateBuildInputFile(localPath, file.Path); err != nil {
			h.updatePreflightFile(id, i, func(item *PreflightFile) {
				item.Status = PreflightFileStatusInvalid
				item.Progress = 100
				item.Message = err.Error()
			})
			h.finishPreflight(id, PreflightStatusInvalid, err.Error())
			return
		}

		h.updatePreflightFile(id, i, func(item *PreflightFile) {
			item.Status = PreflightFileStatusReady
			item.Progress = 100
			item.Cached = true
			item.Message = "ready"
		})
	}

	h.finishPreflight(id, PreflightStatusReady, "all files are cached and valid")
}

type preflightFileResolver interface {
	EnsureFile(ctx context.Context, objectPath string, onProgress func(storage.CacheProgress)) (string, error)
}

type preflightS3Client interface {
	GetObjectInfo(ctx context.Context, objectPath string) (minio.ObjectInfo, error)
	Download(ctx context.Context, objectPath string) (io.ReadCloser, error)
}

var newPreflightS3Client = func(cfg *storage.S3Config) (preflightS3Client, error) {
	return storage.NewS3Client(cfg)
}

type preflightCacheResolver struct {
	manager *storage.CacheManager
}

func (r preflightCacheResolver) EnsureFile(ctx context.Context, objectPath string, onProgress func(storage.CacheProgress)) (string, error) {
	return r.manager.EnsureFileWithProgress(ctx, objectPath, onProgress)
}

type preflightLocalResolver struct {
	store *storage.LocalStore
}

func (r preflightLocalResolver) EnsureFile(ctx context.Context, objectPath string, onProgress func(storage.CacheProgress)) (string, error) {
	localPath, err := r.store.EnsureFile(ctx, objectPath)
	if err != nil {
		return "", err
	}
	info, err := r.store.GetObjectInfo(ctx, objectPath)
	if err == nil && onProgress != nil {
		onProgress(storage.CacheProgress{Current: info.Size, Total: info.Size, Cached: true})
	}
	return localPath, nil
}

func (h *BuildHandler) preflightResolver(ctx context.Context, bucketID uint) (preflightFileResolver, error) {
	var bucket models.StorageBucket
	if err := h.db.WithContext(ctx).First(&bucket, bucketID).Error; err != nil {
		return nil, fmt.Errorf("find storage bucket: %w", err)
	}

	if bucket.Type == models.StorageTypeLocal {
		store, err := storage.NewLocalStore(bucket.LocalPath)
		if err != nil {
			return nil, err
		}
		return preflightLocalResolver{store: store}, nil
	}
	if bucket.Type != "" && bucket.Type != models.StorageTypeS3 {
		return nil, fmt.Errorf("unsupported storage bucket type: %s", bucket.Type)
	}

	client, err := newPreflightS3Client(&storage.S3Config{
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

	manager := storage.NewCacheManagerWithCallbacks(
		filepath.Join(h.workDir, "cache", fmt.Sprintf("bucket-%d", bucket.ID)),
		client.GetObjectInfo,
		client.Download,
	)
	return preflightCacheResolver{manager: manager}, nil
}

func (h *BuildHandler) setPreflight(preflight *BuildPreflight) {
	h.preflightMu.Lock()
	defer h.preflightMu.Unlock()
	h.preflights[preflight.ID] = preflight.clone()
}

func (h *BuildHandler) getPreflight(id string) (*BuildPreflight, bool) {
	h.preflightMu.RLock()
	defer h.preflightMu.RUnlock()
	preflight, ok := h.preflights[id]
	if !ok {
		return nil, false
	}
	return preflight.clone(), true
}

func (h *BuildHandler) updatePreflightFile(id string, index int, update func(*PreflightFile)) {
	h.preflightMu.Lock()
	defer h.preflightMu.Unlock()
	preflight, ok := h.preflights[id]
	if !ok || index < 0 || index >= len(preflight.Files) {
		return
	}
	update(&preflight.Files[index])
	preflight.UpdatedAt = time.Now()
	preflight.Progress = preflight.calculateProgress()
}

func (h *BuildHandler) finishPreflight(id, status, message string) {
	h.preflightMu.Lock()
	defer h.preflightMu.Unlock()
	preflight, ok := h.preflights[id]
	if !ok {
		return
	}
	preflight.Status = status
	preflight.Message = message
	preflight.Progress = preflight.calculateProgress()
	if status == PreflightStatusReady || status == PreflightStatusInvalid || status == PreflightStatusFailed {
		preflight.Progress = 100
	}
	preflight.UpdatedAt = time.Now()
}

func (p *BuildPreflight) calculateProgress() int {
	if p == nil || len(p.Files) == 0 {
		return 100
	}
	total := 0
	for _, file := range p.Files {
		total += file.Progress
	}
	return total / len(p.Files)
}

func (p *BuildPreflight) clone() *BuildPreflight {
	if p == nil {
		return nil
	}
	copyValue := *p
	copyValue.Files = append([]PreflightFile(nil), p.Files...)
	return &copyValue
}
