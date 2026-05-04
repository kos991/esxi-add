package storage

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalStoreRejectsPathTraversal(t *testing.T) {
	store, err := NewLocalStore(t.TempDir())
	if err != nil {
		t.Fatalf("new local store: %v", err)
	}

	if err := store.Upload(context.Background(), "../escape.iso", strings.NewReader("bad"), 3, "application/octet-stream"); err == nil {
		t.Fatal("expected path traversal upload to fail")
	}
}

func TestLocalStoreUploadListResolveAndDelete(t *testing.T) {
	root := t.TempDir()
	store, err := NewLocalStore(root)
	if err != nil {
		t.Fatalf("new local store: %v", err)
	}

	ctx := context.Background()
	if err := store.Upload(ctx, "depots/esxi.zip", strings.NewReader("depot"), 5, "application/zip"); err != nil {
		t.Fatalf("upload: %v", err)
	}

	localPath, err := store.ResolvePath("depots/esxi.zip")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if localPath != filepath.Join(root, "depots", "esxi.zip") {
		t.Fatalf("unexpected local path: %s", localPath)
	}

	objects, err := store.ListObjects(ctx, "depots/")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(objects) != 1 || objects[0].Key != "depots/esxi.zip" || objects[0].Size != 5 {
		t.Fatalf("unexpected objects: %+v", objects)
	}

	if err := store.DeleteObject(ctx, "depots/esxi.zip"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := os.Stat(localPath); !os.IsNotExist(err) {
		t.Fatalf("expected local file to be removed, got %v", err)
	}
}

func TestLocalStoreUploadOverwritesExistingObject(t *testing.T) {
	store, err := NewLocalStore(t.TempDir())
	if err != nil {
		t.Fatalf("new local store: %v", err)
	}

	ctx := context.Background()
	if err := store.Upload(ctx, "depots/esxi.zip", strings.NewReader("old"), 3, "application/zip"); err != nil {
		t.Fatalf("initial upload: %v", err)
	}
	if err := store.Upload(ctx, "depots/esxi.zip", strings.NewReader("new-data"), 8, "application/zip"); err != nil {
		t.Fatalf("overwrite upload: %v", err)
	}

	localPath, err := store.ResolvePath("depots/esxi.zip")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	got, err := os.ReadFile(localPath)
	if err != nil {
		t.Fatalf("read overwritten file: %v", err)
	}
	if string(got) != "new-data" {
		t.Fatalf("expected overwritten content, got %q", string(got))
	}
}
