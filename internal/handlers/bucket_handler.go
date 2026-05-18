package handlers

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/storage"
	"github.com/esxi-builder/esxi-iso-builder/internal/utils"
)

type BucketHandler struct {
	db *gorm.DB
}

type bucketRequest struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	Endpoint     string `json:"endpoint"`
	AccessKey    string `json:"access_key"`
	SecretKey    string `json:"secret_key"`
	BucketName   string `json:"bucket_name"`
	Region       string `json:"region"`
	UseSSL       bool   `json:"use_ssl"`
	PublicDomain string `json:"public_domain"`
	LocalPath    string `json:"local_path"`
	IsDefault    bool   `json:"is_default"`
}

func NewBucketHandler(db *gorm.DB) *BucketHandler {
	return &BucketHandler{db: db}
}

func (h *BucketHandler) Create(c *fiber.Ctx) error {
	var req bucketRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("invalid request body"))
	}
	if err := validateBucketRequest(c.UserContext(), &req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	bucket := models.StorageBucket{
		Name:         req.Name,
		Type:         models.NormalizeStorageType(req.Type),
		Endpoint:     req.Endpoint,
		AccessKey:    req.AccessKey,
		SecretKey:    req.SecretKey,
		BucketName:   req.BucketName,
		Region:       req.Region,
		UseSSL:       req.UseSSL,
		PublicDomain: req.PublicDomain,
		LocalPath:    req.LocalPath,
		IsDefault:    req.IsDefault,
	}

	err := h.db.WithContext(c.UserContext()).Transaction(func(tx *gorm.DB) error {
		if req.IsDefault {
			if err := tx.Model(&models.StorageBucket{}).Where("1 = 1").Update("is_default", false).Error; err != nil {
				return err
			}
		}
		return tx.Create(&bucket).Error
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.Status(fiber.StatusCreated).JSON(utils.SuccessResponse(bucketForResponse(bucket)))
}

func (h *BucketHandler) List(c *fiber.Ctx) error {
	var buckets []models.StorageBucket
	if err := h.db.WithContext(c.UserContext()).Order("id ASC").Find(&buckets).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}
	for index := range buckets {
		buckets[index] = bucketForResponse(buckets[index])
	}
	return c.JSON(utils.SuccessResponse(buckets))
}

func (h *BucketHandler) Get(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	var bucket models.StorageBucket
	if err := h.db.WithContext(c.UserContext()).First(&bucket, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(utils.ErrorResponse("bucket not found"))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(bucketForResponse(bucket)))
}

func (h *BucketHandler) Update(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	var req bucketRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse("invalid request body"))
	}

	var bucket models.StorageBucket
	if err := h.db.WithContext(c.UserContext()).First(&bucket, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(utils.ErrorResponse("bucket not found"))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	mergeBucketUpdateRequest(&req, bucket)
	if err := validateBucketRequest(c.UserContext(), &req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	err = h.db.WithContext(c.UserContext()).Transaction(func(tx *gorm.DB) error {
		if req.IsDefault {
			if err := tx.Model(&models.StorageBucket{}).Where("1 = 1").Update("is_default", false).Error; err != nil {
				return err
			}
		}

		bucket.Name = req.Name
		bucket.Type = models.NormalizeStorageType(req.Type)
		bucket.Endpoint = req.Endpoint
		bucket.AccessKey = req.AccessKey
		bucket.SecretKey = req.SecretKey
		bucket.BucketName = req.BucketName
		bucket.Region = req.Region
		bucket.UseSSL = req.UseSSL
		bucket.PublicDomain = req.PublicDomain
		bucket.LocalPath = req.LocalPath
		bucket.IsDefault = req.IsDefault

		return tx.Save(&bucket).Error
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(bucketForResponse(bucket)))
}

func (h *BucketHandler) Delete(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	if err := h.db.WithContext(c.UserContext()).Delete(&models.StorageBucket{}, id).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(fiber.Map{"deleted": true}))
}

func (h *BucketHandler) TestConnection(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	var bucket models.StorageBucket
	if err := h.db.WithContext(c.UserContext()).First(&bucket, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(utils.ErrorResponse("bucket not found"))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	if err := testBucketConnection(c.UserContext(), &bucket); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(fiber.Map{"connected": true}))
}

func (h *BucketHandler) SetDefault(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
	}

	err = h.db.WithContext(c.UserContext()).Transaction(func(tx *gorm.DB) error {
		var bucket models.StorageBucket
		if err := tx.First(&bucket, id).Error; err != nil {
			return err
		}
		if err := tx.Model(&models.StorageBucket{}).Where("1 = 1").Update("is_default", false).Error; err != nil {
			return err
		}
		return tx.Model(&bucket).Update("is_default", true).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(utils.ErrorResponse("bucket not found"))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
	}

	return c.JSON(utils.SuccessResponse(fiber.Map{"is_default": true, "id": id}))
}

func buildS3Config(req bucketRequest) *storage.S3Config {
	return &storage.S3Config{
		Endpoint:        req.Endpoint,
		AccessKeyID:     req.AccessKey,
		SecretAccessKey: req.SecretKey,
		BucketName:      req.BucketName,
		Region:          req.Region,
		UseSSL:          req.UseSSL,
		PublicDomain:    req.PublicDomain,
	}
}

func bucketForResponse(bucket models.StorageBucket) models.StorageBucket {
	bucket.PublicDomain = storage.NormalizePublicDomain(bucket.PublicDomain)
	bucket.SecretKey = ""
	return bucket
}

func mergeBucketUpdateRequest(req *bucketRequest, existing models.StorageBucket) {
	if req == nil {
		return
	}
	if models.NormalizeStorageType(req.Type) == models.StorageTypeS3 && strings.TrimSpace(req.SecretKey) == "" {
		req.SecretKey = existing.SecretKey
	}
}

func validateBucketRequest(ctx context.Context, req *bucketRequest) error {
	req.Name = strings.TrimSpace(req.Name)
	req.Type = models.NormalizeStorageType(req.Type)
	req.Endpoint = strings.TrimSpace(req.Endpoint)
	req.AccessKey = strings.TrimSpace(req.AccessKey)
	req.SecretKey = strings.TrimSpace(req.SecretKey)
	req.BucketName = strings.TrimSpace(req.BucketName)
	req.Region = strings.TrimSpace(req.Region)
	req.PublicDomain = strings.TrimSpace(req.PublicDomain)
	req.LocalPath = strings.TrimSpace(req.LocalPath)

	if req.Name == "" {
		return fmt.Errorf("bucket name is required")
	}

	switch req.Type {
	case models.StorageTypeS3:
		client, err := storage.NewS3Client(buildS3Config(*req))
		if err != nil {
			return err
		}
		return client.TestConnection(ctx)
	case models.StorageTypeLocal:
		store, err := storage.NewLocalStore(req.LocalPath)
		if err != nil {
			return err
		}
		return store.TestConnection(ctx)
	default:
		return fmt.Errorf("unsupported storage type: %s", req.Type)
	}
}

func testBucketConnection(ctx context.Context, bucket *models.StorageBucket) error {
	switch models.NormalizeStorageType(bucket.Type) {
	case models.StorageTypeS3:
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
			return err
		}
		return client.TestConnection(ctx)
	case models.StorageTypeLocal:
		store, err := storage.NewLocalStore(bucket.LocalPath)
		if err != nil {
			return err
		}
		return store.TestConnection(ctx)
	default:
		return fmt.Errorf("unsupported storage type: %s", bucket.Type)
	}
}

func parseUintParam(c *fiber.Ctx, name string) (uint, error) {
	value := c.Params(name)
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, err
	}
	return uint(parsed), nil
}
