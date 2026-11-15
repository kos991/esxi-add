package services

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/esxi-builder/esxi-iso-builder/internal/models"
)

func TestRefreshReconcilesOnlyCompleteScanAndPreservesHashes(t *testing.T) {
	root := t.TempDir()
	db, id := newLocalFileServiceTestDB(t, root)
	svc := NewFileService(db, nil)
	old := models.FileMetadata{StorageBucketID: id, Path: "gone.iso", Type: models.FileTypeISO}
	keep := models.FileMetadata{StorageBucketID: id, Path: "nested/VMware-ESXi-8.0.iso", Type: models.FileTypeISO, MD5: "trusted-md5", SHA256: "trusted-sha"}
	active := models.FileMetadata{StorageBucketID: id, Path: "active.iso", Type: models.FileTypeISO}
	for _, file := range []*models.FileMetadata{&old, &keep, &active} {
		if err := db.Create(file).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(root, "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(keep.Path)), []byte("iso"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "plain.zip"), []byte("zip"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := svc.RefreshCache(ctx, id); err == nil {
		t.Fatal("cancelled scan succeeded")
	}
	if err := db.First(&models.FileMetadata{}, old.ID).Error; err != nil {
		t.Fatal("failed scan deleted metadata", err)
	}
	key := fmt.Sprintf("%d:%s", id, active.Path)
	activeUploads.Store(key, struct{}{})
	defer activeUploads.Delete(key)
	if err := svc.RefreshCache(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&models.FileMetadata{}).Where("id = ?", old.ID).Count(&count)
	if count != 0 {
		t.Fatal("successful scan retained stale entry")
	}
	if err := db.First(&keep, keep.ID).Error; err != nil {
		t.Fatal(err)
	}
	if keep.MD5 != "trusted-md5" || keep.SHA256 != "trusted-sha" || keep.ESXiVersion != "8.0" {
		t.Fatalf("metadata lost: %+v", keep)
	}
	if err := db.First(&models.FileMetadata{}, active.ID).Error; err != nil {
		t.Fatal("active upload deleted")
	}
	var unknown models.FileMetadata
	if err := db.Where("path = ?", "plain.zip").First(&unknown).Error; err != nil || unknown.Type != "unknown" {
		t.Fatalf("unknown ZIP classification: %+v %v", unknown, err)
	}
	// Missing root is a failed scan, never an empty successful snapshot.
	if err := db.Model(&models.StorageBucket{}).Where("id = ?", id).Update("local_path", filepath.Join(root, "missing")).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.RefreshCache(context.Background(), id); err == nil {
		t.Fatal("missing root accepted")
	}
	if err := db.First(&models.FileMetadata{}, keep.ID).Error; err != nil {
		t.Fatal("missing root deleted metadata")
	}
}

func TestReferencedArtifactCannotBeRenamedOrDeleted(t *testing.T) {
	root := t.TempDir()
	db, id := newLocalFileServiceTestDB(t, root)
	if err := db.AutoMigrate(&models.BuildTask{}); err != nil {
		t.Fatal(err)
	}
	svc := NewFileService(db, nil)
	file := models.FileMetadata{StorageBucketID: id, Path: "result.iso", Type: models.FileTypeISO}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, file.Path), []byte("artifact"), 0600); err != nil {
		t.Fatal(err)
	}
	task := models.BuildTask{TaskID: "reference", StorageBucketID: id, Status: models.BuildTaskStatusCompleted, OutputISO: file.Path}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteFile(context.Background(), file.ID); err == nil {
		t.Fatal("deleted referenced artifact")
	}
	if _, err := svc.RenameFile(context.Background(), file.ID, "other.iso"); err == nil {
		t.Fatal("renamed referenced artifact")
	}
	if _, err := os.Stat(filepath.Join(root, file.Path)); err != nil {
		t.Fatal(err)
	}
}
