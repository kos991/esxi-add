package models

import "time"

const (
	FileTypeDepot  = "depot"
	FileTypeDriver = "driver"
	FileTypeISO    = "iso"
)

type FileMetadata struct {
	BaseModel
	StorageBucketID   uint           `gorm:"not null;index;uniqueIndex:idx_storage_bucket_path" json:"storage_bucket_id"`
	StorageBucket     *StorageBucket `gorm:"foreignKey:StorageBucketID" json:"storage_bucket,omitempty"`
	Path              string         `gorm:"type:text;not null;uniqueIndex:idx_storage_bucket_path" json:"path"`
	Type              string         `gorm:"size:32;not null;index" json:"type"`
	ESXiVersion       string         `gorm:"column:esxi_version;index" json:"esxi_version"`
	DriverCategory    string         `gorm:"index" json:"driver_category"`
	DriverType        string         `gorm:"index" json:"driver_type"`
	DriverName        string         `json:"driver_name"`
	DriverDescription string         `gorm:"type:text" json:"driver_description"`
	DriverVersion     string         `json:"driver_version"`
	IsLatest          bool           `gorm:"default:false;index" json:"is_latest"`
	ConflictsWith     string         `gorm:"type:text" json:"conflicts_with"`
	DependsOn         string         `gorm:"type:text" json:"depends_on"`
	MD5               string         `gorm:"column:md5" json:"md5"`
	SHA256            string         `json:"sha256"`
	Size              int64          `json:"size"`
	ETag              string         `gorm:"column:etag" json:"etag"`
	LastModified      *time.Time     `json:"last_modified"`
	Cached            bool           `gorm:"-" json:"cached"`
	CacheValid        bool           `gorm:"-" json:"cache_valid"`
	CacheStatus       string         `gorm:"-" json:"cache_status"`
}
