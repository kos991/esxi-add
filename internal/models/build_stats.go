package models

type BuildStats struct {
    BaseModel
    Date          string `gorm:"uniqueIndex;not null" json:"date"`
    TotalBuilds   int    `gorm:"default:0" json:"total_builds"`
    SuccessBuilds int    `gorm:"default:0" json:"success_builds"`
    FailedBuilds  int    `gorm:"default:0" json:"failed_builds"`
    AvgDuration   int    `json:"avg_duration"`
    TotalSize     int64  `json:"total_size"`
}
