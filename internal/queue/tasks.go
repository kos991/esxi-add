package queue

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/hibiken/asynq"
)

const TypeBuildISO = "build:iso"

type BuildISOPayload struct {
	TaskID        string   `json:"task_id"`
	BucketID      uint     `json:"bucket_id"`
	DepotPath     string   `json:"depot_path"`
	DriverPaths   []string `json:"driver_paths"`
	ESXiVersion   string   `json:"esxi_version"`
	CustomISOName string   `json:"custom_iso_name"`
}

func NewBuildISOTask(p *BuildISOPayload) (*asynq.Task, error) {
	data, err := json.Marshal(p)
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TypeBuildISO, data), nil
}

// BuildOutputFileName generates the output ISO filename from a custom name or ESXi version.
func BuildOutputFileName(customISOName, esxiVersion string) string {
	if strings.TrimSpace(customISOName) != "" {
		name := filepath.Base(strings.ReplaceAll(strings.TrimSpace(customISOName), "\\", "/"))
		if strings.EqualFold(filepath.Ext(name), ".iso") {
			return name
		}
		return name + ".iso"
	}
	return fmt.Sprintf("ESXi-%s-custom-%s.iso", esxiVersion, time.Now().Format("20060102-150405"))
}
