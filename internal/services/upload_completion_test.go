package services

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
	"gorm.io/gorm"
)

func TestUploadCompletesMetadataAfterRequestCancellation(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)
	pool, _ := db.DB()
	defer pool.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := db.Callback().Create().Before("gorm:begin_transaction").Register("cancel_after_storage", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Dest.(*models.FileMetadata); !ok {
			return
		}
		if _, err := os.Stat(filepath.Join(root, "depots", "test.zip")); err != nil {
			t.Errorf("storage not committed: %v", err)
		}
		cancel()
	})
	if err != nil {
		t.Fatal(err)
	}
	metadata, err := NewFileService(db, nil).UploadFile(ctx, bucketID, "depot", "", "", "test.zip", strings.NewReader("payload"), 7)
	if err != nil {
		t.Fatal(err)
	}
	if ctx.Err() == nil || metadata.ID == 0 || metadata.SHA256 == "" {
		t.Fatalf("invalid completion: %+v", metadata)
	}
}

func TestStoredUploadFailureCanReconcileWithoutReupload(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)
	pool, _ := db.DB()
	defer pool.Close()
	fault := errors.New("injected metadata failure")
	if err := db.Callback().Create().Before("gorm:create").Register("fail_metadata", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Dest.(*models.FileMetadata); ok {
			tx.AddError(fault)
		}
	}); err != nil {
		t.Fatal(err)
	}
	service := NewFileService(db, nil)
	metadata, err := service.UploadFile(context.Background(), bucketID, "depot", "", "", "test.zip", strings.NewReader("payload"), 7)
	var stored *StoredUploadError
	if !errors.As(err, &stored) || !errors.Is(err, fault) {
		t.Fatalf("expected stored outcome, got %v", err)
	}
	if metadata == nil || stored.Metadata.Path != "depots/test.zip" {
		t.Fatalf("missing reconciliation identity: %+v", stored)
	}
	if err := db.Callback().Create().Remove("fail_metadata"); err != nil {
		t.Fatal(err)
	}
	if err := service.RefreshCache(context.Background(), bucketID); err != nil {
		t.Fatal(err)
	}
	files, err := service.ListDepots(context.Background(), bucketID)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Size != 7 {
		t.Fatalf("reconciliation failed: %+v", files)
	}
	data, err := os.ReadFile(filepath.Join(root, "depots", "test.zip"))
	if err != nil || string(data) != "payload" {
		t.Fatalf("stored bytes lost: %q %v", data, err)
	}
}
