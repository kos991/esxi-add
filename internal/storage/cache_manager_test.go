package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/minio/minio-go/v7"
)

func TestCacheManagerStatusReportsMissingCachedStaleAndInvalid(t *testing.T) {
	cacheDir := t.TempDir()
	manager := NewCacheManager(cacheDir, nil)

	object := minio.ObjectInfo{Key: "driver/6x/net.zip", ETag: "remote-etag"}

	status, err := manager.Status("driver/6x/net.zip", object)
	if err != nil {
		t.Fatalf("missing status: %v", err)
	}
	if status.Status != CacheStatusMissing || status.Cached || status.Valid {
		t.Fatalf("expected missing status, got %+v", status)
	}

	writeCacheFile(t, cacheDir, "driver/6x/net.zip", []byte("PK\x03\x04zip"), "remote-etag")
	status, err = manager.Status("driver/6x/net.zip", object)
	if err != nil {
		t.Fatalf("cached status: %v", err)
	}
	if status.Status != CacheStatusCached || !status.Cached || !status.Valid {
		t.Fatalf("expected cached status, got %+v", status)
	}

	writeCacheFile(t, cacheDir, "driver/6x/net.zip", []byte("PK\x03\x04zip"), "old-etag")
	status, err = manager.Status("driver/6x/net.zip", object)
	if err != nil {
		t.Fatalf("stale status: %v", err)
	}
	if status.Status != CacheStatusStale || !status.Cached || !status.Valid {
		t.Fatalf("expected stale status, got %+v", status)
	}

	writeCacheFile(t, cacheDir, "driver/6x/net.zip", []byte("\n<!DOCTYPE html>"), "remote-etag")
	status, err = manager.Status("driver/6x/net.zip", object)
	if err != nil {
		t.Fatalf("invalid status: %v", err)
	}
	if status.Status != CacheStatusInvalid || !status.Cached || status.Valid {
		t.Fatalf("expected invalid status, got %+v", status)
	}
}

func TestCacheManagerEnsureFileRefreshesInvalidCachedArchive(t *testing.T) {
	cacheDir := t.TempDir()
	objectPath := "driver/6x/net.zip"
	writeCacheFile(t, cacheDir, objectPath, []byte("\n<!DOCTYPE html>"), "remote-etag")

	manager := NewCacheManager(cacheDir, nil)
	downloads := 0
	manager.getObjectInfo = func(ctx context.Context, path string) (minio.ObjectInfo, error) {
		if path != objectPath {
			t.Fatalf("unexpected object path: %s", path)
		}
		return minio.ObjectInfo{Key: objectPath, ETag: "remote-etag"}, nil
	}
	manager.downloadObject = func(ctx context.Context, path string) (io.ReadCloser, error) {
		downloads++
		if path != objectPath {
			t.Fatalf("unexpected object path: %s", path)
		}
		return io.NopCloser(strings.NewReader("PK\x03\x04zip-data")), nil
	}

	localPath, err := manager.EnsureFile(context.Background(), objectPath)
	if err != nil {
		t.Fatalf("ensure file: %v", err)
	}
	if downloads != 1 {
		t.Fatalf("expected invalid cache to be downloaded once, got %d", downloads)
	}
	got, err := os.ReadFile(localPath)
	if err != nil {
		t.Fatalf("read refreshed cache: %v", err)
	}
	if string(got) != "PK\x03\x04zip-data" {
		t.Fatalf("expected refreshed cache content, got %q", string(got))
	}
}

func writeCacheFile(t *testing.T, cacheDir, objectPath string, content []byte, etag string) {
	t.Helper()
	localPath := filepath.Join(cacheDir, filepath.FromSlash(objectPath))
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		t.Fatalf("mkdir cache path: %v", err)
	}
	if err := os.WriteFile(localPath, content, 0o644); err != nil {
		t.Fatalf("write cache file: %v", err)
	}
	if err := os.WriteFile(localPath+".etag", []byte(etag), 0o644); err != nil {
		t.Fatalf("write cache etag: %v", err)
	}
}
