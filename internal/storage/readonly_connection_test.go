package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestS3ConnectionNeverCreatesBucket(t *testing.T) {
	var missing atomic.Bool
	var denied atomic.Bool
	var mutations atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "HEAD" && r.Method != "GET" {
			mutations.Add(1)
			w.WriteHeader(500)
			return
		}
		if missing.Load() {
			w.WriteHeader(404)
			return
		}
		if r.Method == "HEAD" {
			return
		}
		if denied.Load() {
			w.WriteHeader(403)
			_, _ = w.Write([]byte(`<Error><Code>AccessDenied</Code><Message>denied</Message></Error>`))
			return
		}
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<ListBucketResult><Name>test-bucket</Name><IsTruncated>false</IsTruncated></ListBucketResult>`))
	}))
	defer server.Close()
	cfg := &S3Config{Endpoint: server.URL, BucketName: "test-bucket", Region: "us-east-1", AccessKeyID: "fake", SecretAccessKey: "fake-secret"}
	missing.Store(true)
	if _, err := NewS3Client(cfg); err == nil {
		t.Fatal("missing bucket accepted")
	}
	missing.Store(false)
	client, err := NewS3Client(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.TestConnection(context.Background()); err != nil {
		t.Fatal(err)
	}
	denied.Store(true)
	if err := client.TestConnection(context.Background()); err == nil {
		t.Fatal("list denied accepted")
	}
	missing.Store(true)
	if err := client.TestConnection(context.Background()); err == nil {
		t.Fatal("BucketExists false ignored")
	}
	if mutations.Load() != 0 {
		t.Fatalf("mutation requests: %d", mutations.Load())
	}
}

func TestLocalConnectionOnlyReadsExistingDirectory(t *testing.T) {
	root := t.TempDir()
	missing := filepath.Join(root, "absent")
	store, err := NewLocalStore(missing)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.TestConnection(context.Background()); err == nil {
		t.Fatal("missing directory accepted")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatal("test created directory")
	}
	store, _ = NewLocalStore(root)
	if err := store.TestConnection(context.Background()); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 0 {
		t.Fatal("probe wrote files")
	}
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if err := store.TestConnection(ctx); err == nil {
		t.Fatal("cancellation ignored")
	}
}
