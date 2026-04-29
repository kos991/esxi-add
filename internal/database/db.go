package database

import (
    "fmt"
    "os"
    "path/filepath"

    "gorm.io/driver/sqlite"
    "gorm.io/gorm"

    "github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func InitDB(path string) (*gorm.DB, error) {
    if dir := filepath.Dir(path); dir != "" && dir != "." {
        if err := os.MkdirAll(dir, 0o755); err != nil {
            return nil, fmt.Errorf("create database directory: %w", err)
        }
    }

    db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
    if err != nil {
        return nil, fmt.Errorf("open database: %w", err)
    }

    if err := db.AutoMigrate(
        &models.StorageBucket{},
        &models.FileMetadata{},
        &models.BuildTask{},
        &models.BuildTemplate{},
        &models.BuildStats{},
        &models.AuditLog{},
    ); err != nil {
        return nil, fmt.Errorf("auto migrate database: %w", err)
    }

    return db, nil
}
