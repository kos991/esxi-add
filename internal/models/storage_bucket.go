package models

import (
	"time"

	"gorm.io/gorm"
)

type BaseModel struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

const (
	StorageTypeS3    = "s3"
	StorageTypeLocal = "local"
)

type StorageBucket struct {
	BaseModel
	Name         string `gorm:"uniqueIndex;not null" json:"name"`
	Type         string `gorm:"size:32;not null;default:s3;index" json:"type"`
	Endpoint     string `json:"endpoint"`
	AccessKey    string `json:"access_key"`
	SecretKey    string `json:"secret_key,omitempty"`
	BucketName   string `json:"bucket_name"`
	Region       string `json:"region"`
	UseSSL       bool   `gorm:"default:true" json:"use_ssl"`
	PublicDomain string `json:"public_domain"`
	LocalPath    string `json:"local_path"`
	IsDefault    bool   `gorm:"default:false" json:"is_default"`
}
