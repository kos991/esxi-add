package queue

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/esxi-builder/esxi-iso-builder/internal/builder"
	"github.com/esxi-builder/esxi-iso-builder/internal/database"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func TestCancelledBuildPersistsTailAndFailure(t *testing.T) {
	db, err := database.InitDB(filepath.Join(t.TempDir(), "cancel.db"))
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	defer pool.Close()
	row := models.BuildTask{TaskID: "cancelled", Status: models.BuildTaskStatusRunning}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	handler := NewBuildTaskHandler(db, builder.NewPowerShellExecutor("unused", "unused"), t.TempDir(), nil)
	events := make(chan builder.BuildProgress, 2)
	events <- builder.BuildProgress{Percentage: 50, Message: "tail-one"}
	events <- builder.BuildProgress{Percentage: 60, Message: "tail-two"}
	close(events)
	if err := handler.consumeProgress(ctx, row.TaskID, events); err != nil {
		t.Fatal(err)
	}
	task, err := NewBuildISOTask(&BuildISOPayload{TaskID: row.TaskID})
	if err != nil {
		t.Fatal(err)
	}
	if err := handler.HandleBuildISO(ctx, task); err == nil {
		t.Fatal("expected cancelled build failure")
	}
	if err := db.First(&row, row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != models.BuildTaskStatusFailed || row.ErrorMessage == "" || row.CompletedAt == nil {
		t.Fatalf("failure not persisted: %+v", row)
	}
	if !strings.Contains(row.LogOutput, "tail-one\ntail-two\n") {
		t.Fatalf("tail lost: %q", row.LogOutput)
	}
}
