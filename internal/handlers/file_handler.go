package handlers

import (
	"errors"
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
