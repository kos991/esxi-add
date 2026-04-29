package handlers

import (
    "errors"
    "strconv"

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
    Endpoint     string `json:"endpoint"`
    AccessKey    string `json:"access_key"`
    SecretKey    string `json:"secret_key"`
    BucketName   string `json:"bucket_name"`
    Region       string `json:"region"`
    UseSSL       bool   `json:"use_ssl"`
    PublicDomain string `json:"public_domain"`
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

    client, err := storage.NewS3Client(buildS3Config(req))
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
    }
    if err := client.TestConnection(c.UserContext()); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
    }

    bucket := models.StorageBucket{
        Name:         req.Name,
        Endpoint:     req.Endpoint,
        AccessKey:    req.AccessKey,
        SecretKey:    req.SecretKey,
        BucketName:   req.BucketName,
        Region:       req.Region,
        UseSSL:       req.UseSSL,
        PublicDomain: req.PublicDomain,
        IsDefault:    req.IsDefault,
    }

    err = h.db.WithContext(c.UserContext()).Transaction(func(tx *gorm.DB) error {
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

    return c.Status(fiber.StatusCreated).JSON(utils.SuccessResponse(bucket))
}

func (h *BucketHandler) List(c *fiber.Ctx) error {
    var buckets []models.StorageBucket
    if err := h.db.WithContext(c.UserContext()).Order("id ASC").Find(&buckets).Error; err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
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

    return c.JSON(utils.SuccessResponse(bucket))
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

    err = h.db.WithContext(c.UserContext()).Transaction(func(tx *gorm.DB) error {
        if req.IsDefault {
            if err := tx.Model(&models.StorageBucket{}).Where("1 = 1").Update("is_default", false).Error; err != nil {
                return err
            }
        }

        bucket.Name = req.Name
        bucket.Endpoint = req.Endpoint
        bucket.AccessKey = req.AccessKey
        bucket.SecretKey = req.SecretKey
        bucket.BucketName = req.BucketName
        bucket.Region = req.Region
        bucket.UseSSL = req.UseSSL
        bucket.PublicDomain = req.PublicDomain
        bucket.IsDefault = req.IsDefault

        return tx.Save(&bucket).Error
    })
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(utils.ErrorResponse(err.Error()))
    }

    return c.JSON(utils.SuccessResponse(bucket))
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
        return c.Status(fiber.StatusBadRequest).JSON(utils.ErrorResponse(err.Error()))
    }

    if err := client.TestConnection(c.UserContext()); err != nil {
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

func parseUintParam(c *fiber.Ctx, name string) (uint, error) {
    value := c.Params(name)
    parsed, err := strconv.ParseUint(value, 10, 64)
    if err != nil {
        return 0, err
    }
    return uint(parsed), nil
}
