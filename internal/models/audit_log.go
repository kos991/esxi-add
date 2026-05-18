package models

import "time"

type AuditLog struct {
    ID           uint      `gorm:"primaryKey" json:"id"`
    CreatedAt    time.Time `json:"created_at"`
    Action       string    `gorm:"not null;index" json:"action"`
    ResourceType string    `gorm:"not null;index" json:"resource_type"`
    ResourceID   string    `gorm:"index" json:"resource_id"`
    Details      string    `gorm:"type:text" json:"details"`
    IPAddress    string    `json:"ip_address"`
    UserAgent    string    `json:"user_agent"`
}
