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

type StorageBucket struct {
    BaseModel
    Name         string `gorm:"uniqueIndex;not null" json:"name"`
    Endpoint     string `json:"endpoint"`
    AccessKey    string `json:"access_key"`
    SecretKey    string `json:"secret_key,omitempty"`
    BucketName   string `json:"bucket_name"`
    Region       string `json:"region"`
    UseSSL       bool   `gorm:"default:true" json:"use_ssl"`
    PublicDomain string `json:"public_domain"`
    IsDefault    bool   `gorm:"default:false" json:"is_default"`
}
