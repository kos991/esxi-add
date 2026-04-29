package queue

import (
	"encoding/json"

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
