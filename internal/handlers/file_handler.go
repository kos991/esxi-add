package handlers

import (
	"errors"
	"mime"
	"os"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/services"
	"github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

type FileHandler struct {
	fileService *services.FileService
}

func NewFileHandler(svc *services.FileService) *FileHandler {
	return &FileHandler{fileService: svc}
}

func (h *FileHandler) ListDepots(c *fiber.Ctx) error {
	bucketID, err := parseBucketID(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	files, err := h.fileService.ListDepots(c.UserContext(), bucketID, c.Query("esxi_version"))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}
	return c.JSON(utils.SuccessResponse(files))
}

func (h *FileHandler) ListDrivers(c *fiber.Ctx) error {
	bucketID, err := parseBucketID(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	files, err := h.fileService.ListDrivers(c.UserContext(), bucketID, c.Query("esxi_version"), c.Query("category"))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}
	return c.JSON(utils.SuccessResponse(files))
}

func (h *FileHandler) ListISOs(c *fiber.Ctx) error {
	bucketID, err := parseBucketID(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	files, err := h.fileService.ListISOs(c.UserContext(), bucketID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}
	return c.JSON(utils.SuccessResponse(files))
}

func (h *FileHandler) UploadFile(c *fiber.Ctx) error {
	bucketID, err := parseBucketID(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
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

	metadata, err := h.fileService.UploadFile(
		c.UserContext(),
		bucketID,
		c.FormValue("type"),
		c.FormValue("esxi_version"),
		c.FormValue("category"),
		fileHeader.Filename,
		file,
		fileHeader.Size,
	)
	if err != nil {
		if errors.Is(err, services.ErrUploadConflict) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"success": false, "error": err.Error(), "code": "upload_in_progress",
				"data": fiber.Map{"stored": false, "metadata_confirmed": false},
			})
		}
		var stored *services.StoredUploadError
		if errors.As(err, &stored) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"success": false, "error": stored.Error(), "code": "upload_stored_metadata_pending",
				"data": fiber.Map{"stored": true, "metadata_confirmed": false, "file": stored.Metadata},
			})
		}
		status := fiber.StatusInternalServerError
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status = fiber.StatusNotFound
		}
		return c.Status(status).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.Status(fiber.StatusCreated).JSON(utils.SuccessResponse(metadata))
}

func (h *FileHandler) DeleteFile(c *fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("invalid file id"))
	}

	if err := h.fileService.DeleteFile(c.UserContext(), uint(id)); err != nil {
		status := fiber.StatusInternalServerError
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status = fiber.StatusNotFound
		}
		return c.Status(status).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(fiber.Map{"deleted": true}))
}

func (h *FileHandler) RenameFile(c *fiber.Ctx) error {
	id, err := strconv.ParseUint(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("invalid file id"))
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("invalid rename request"))
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("name is required"))
	}

	metadata, err := h.fileService.RenameFile(c.UserContext(), uint(id), req.Name)
	if err != nil {
		status := fiber.StatusInternalServerError
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status = fiber.StatusNotFound
		}
		return c.Status(status).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(metadata))
}

func (h *FileHandler) RefreshCache(c *fiber.Ctx) error {
	bucketID, err := parseBucketID(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	if err := h.fileService.RefreshCache(c.UserContext(), bucketID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(fiber.Map{"refreshed": true, "bucket_id": bucketID}))
}

func (h *FileHandler) List(c *fiber.Ctx) error {
	id, err := parseBucketID(c)
	if err != nil {
		return c.Status(400).JSON(utils.ErrorResponse(err.Error()))
	}
	files, err := h.fileService.ListFiles(c.UserContext(), id)
	if err != nil {
		return c.Status(500).JSON(utils.ErrorResponse(err.Error()))
	}
	return c.JSON(utils.SuccessResponse(files))
}

func (h *FileHandler) Download(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return c.Status(400).JSON(utils.ErrorResponse("invalid file id"))
	}
	reader, name, err := h.fileService.OpenFile(c.UserContext(), id)
	if err != nil {
		status := 400
		if errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, os.ErrNotExist) {
			status = 404
		}
		return c.Status(status).JSON(utils.ErrorResponse(err.Error()))
	}
	c.Set(fiber.HeaderContentDisposition, mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	c.Set(fiber.HeaderContentType, "application/octet-stream")
	c.Set("X-Content-Type-Options", "nosniff")
	return c.SendStream(reader)
}

func (h *FileHandler) ArchiveToS3(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("invalid file id"))
	}

	var req struct {
		TargetBucketID uint `json:"target_bucket_id"`
	}
	_ = c.BodyParser(&req)
	if req.TargetBucketID == 0 {
		if q := c.Query("target_bucket_id"); q != "" {
			if parsed, pErr := strconv.ParseUint(q, 10, 64); pErr == nil {
				req.TargetBucketID = uint(parsed)
			}
		}
	}

	res, err := h.fileService.ArchiveFileToS3(c.UserContext(), id, req.TargetBucketID)
	if err != nil {
		status := fiber.StatusInternalServerError
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status = fiber.StatusNotFound
		}
		return c.Status(status).JSON(utils.ErrorResponse(err.Error()))
	}
	return c.JSON(utils.SuccessResponse(res))
}

func (h *FileHandler) ArchiveOutputsToS3(c *fiber.Ctx) error {
	var req struct {
		SourceBucketID uint `json:"source_bucket_id"`
		TargetBucketID uint `json:"target_bucket_id"`
	}
	_ = c.BodyParser(&req)
	if req.SourceBucketID == 0 {
		if q := c.Query("bucket_id"); q != "" {
			if parsed, pErr := strconv.ParseUint(q, 10, 64); pErr == nil {
				req.SourceBucketID = uint(parsed)
			}
		}
	}
	if req.TargetBucketID == 0 {
		if q := c.Query("target_bucket_id"); q != "" {
			if parsed, pErr := strconv.ParseUint(q, 10, 64); pErr == nil {
				req.TargetBucketID = uint(parsed)
			}
		}
	}

	res, err := h.fileService.ArchiveLocalOutputsToS3(c.UserContext(), req.SourceBucketID, req.TargetBucketID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}
	return c.JSON(utils.SuccessResponse(res))
}

func parseBucketID(c *fiber.Ctx) (uint, error) {
	value := c.Query("bucket_id")
	if value == "" {
		value = c.FormValue("bucket_id")
	}
	if value == "" {
		return 0, fiber.NewError(fiber.StatusBadRequest, "bucket_id is required")
	}

	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, fiber.NewError(fiber.StatusBadRequest, "invalid bucket_id")
	}
	return uint(parsed), nil
}
