package models

import "time"

const (
    BuildTaskStatusPending   = "pending"
    BuildTaskStatusRunning   = "running"
    BuildTaskStatusCompleted = "completed"
    BuildTaskStatusFailed    = "failed"
)

type BuildTask struct {
    BaseModel
    TaskID           string         `gorm:"uniqueIndex;not null" json:"task_id"`
    Status           string         `gorm:"size:32;not null;index" json:"status"`
    StorageBucketID  uint           `gorm:"index" json:"storage_bucket_id"`
    StorageBucket    *StorageBucket `gorm:"foreignKey:StorageBucketID" json:"storage_bucket,omitempty"`
    ESXiVersion      string         `gorm:"index" json:"esxi_version"`
    DepotPath        string         `json:"depot_path"`
    Drivers          string         `gorm:"type:text" json:"drivers"`
    CustomISOName    string         `json:"custom_iso_name"`
    Progress         int            `gorm:"default:0" json:"progress"`
    LogOutput        string         `gorm:"type:text" json:"log_output"`
    OutputISO        string         `json:"output_iso"`
    OutputISOSize    int64          `json:"output_iso_size"`
    OutputISOSHA256  string         `json:"output_iso_sha256"`
    ErrorMessage     string         `gorm:"type:text" json:"error_message"`
    BuildDuration    int            `json:"build_duration"`
    StartedAt        *time.Time     `json:"started_at"`
    CompletedAt      *time.Time     `json:"completed_at"`
}
