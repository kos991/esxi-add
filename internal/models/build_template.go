package models

type BuildTemplate struct {
    BaseModel
    Name        string `gorm:"not null" json:"name"`
    Description string `gorm:"type:text" json:"description"`
    ESXiVersion string `gorm:"index" json:"esxi_version"`
    DepotPath   string `json:"depot_path"`
    Drivers     string `gorm:"type:text" json:"drivers"`
}
