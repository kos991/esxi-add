package queue

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/esxi-builder/esxi-iso-builder/internal/builder"
	"github.com/esxi-builder/esxi-iso-builder/internal/database"
	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"github.com/esxi-builder/esxi-iso-builder/internal/services"
	"gorm.io/gorm"
)

func TestProgressConcurrentStatusAndUploads(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "concurrent.db")
	db, err := database.InitDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	// A separate pool exercises the API/worker process boundary and WAL locks.
	apiDB, err := database.InitDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	apiSQL, _ := apiDB.DB()
	defer apiSQL.Close()
	task := models.BuildTask{TaskID: "concurrent", Status: models.BuildTaskStatusRunning}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	bucket := models.StorageBucket{Name: "Local", Type: models.StorageTypeLocal, LocalPath: t.TempDir()}
	if err := apiDB.Create(&bucket).Error; err != nil {
		t.Fatal(err)
	}
	var writes atomic.Int64
	if err := db.Callback().Update().After("gorm:update").Register("count_writes", func(tx *gorm.DB) { writes.Add(1) }); err != nil {
		t.Fatal(err)
	}
	events := make(chan builder.BuildProgress)
	errors := make(chan error, 3)
	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		errors <- NewBuildTaskHandler(db, nil, "", nil).consumeProgress(context.Background(), task.TaskID, events)
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			var current models.BuildTask
			if err := apiDB.Where("task_id = ?", task.TaskID).First(&current).Error; err != nil {
				errors <- err
				return
			}
		}
		errors <- nil
	}()
	go func() {
		defer wg.Done()
		service := services.NewFileService(apiDB, nil)
		for i := 0; i < 20; i++ {
			body := fmt.Sprintf("payload-%d", i)
			if _, err := service.UploadFile(context.Background(), bucket.ID, "depot", "8.0", "", fmt.Sprintf("file-%d.zip", i), strings.NewReader(body), int64(len(body))); err != nil {
				errors <- err
				return
			}
		}
		errors <- nil
	}()
	for i := 0; i < 500; i++ {
		events <- builder.BuildProgress{Percentage: i % 101, Message: fmt.Sprintf("line-%d", i)}
	}
	close(events)
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Error(err)
		}
	}
	var result models.BuildTask
	if err := db.Where("task_id = ?", task.TaskID).First(&result).Error; err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(result.LogOutput, "\n"); n != 500 {
		t.Fatalf("log count=%d, want 500", n)
	}
	for i := 0; i < 500; i++ {
		if !strings.Contains(result.LogOutput, fmt.Sprintf("line-%d\n", i)) {
			t.Fatalf("missing line %d", i)
		}
	}
	if result.Progress == 100 {
		t.Fatal("completed before artifact persistence")
	}
	var count int64
	if err := apiDB.Model(&models.FileMetadata{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 20 {
		t.Fatalf("uploads=%d", count)
	}
	if writes.Load() >= 500 {
		t.Fatalf("log write count was not reduced: %d", writes.Load())
	}
	t.Logf("500 log events persisted with %d SQL updates; 20 uploads and 100 status reads succeeded", writes.Load())
}
