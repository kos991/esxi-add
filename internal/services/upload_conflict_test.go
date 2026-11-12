package services

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConcurrentSamePathUploadRejectsBeforeWriting(t *testing.T) {
	root := t.TempDir()
	db, bucketID := newLocalFileServiceTestDB(t, root)
	pool, _ := db.DB()
	defer pool.Close()
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := NewFileService(db, nil).UploadFile(context.Background(), bucketID, "depot", "", "", "same.zip", &signalReader{Reader: reader, started: started}, 5)
		done <- err
	}()
	<-started
	_, err := NewFileService(db, nil).UploadFile(context.Background(), bucketID, "depot", "", "", "same.zip", strings.NewReader("other"), 5)
	if !errors.Is(err, ErrUploadConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
	if _, err := writer.Write([]byte("first")); err != nil {
		t.Fatal(err)
	}
	writer.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(root, "depots", "same.zip"))
	if err != nil || string(bytes) != "first" {
		t.Fatalf("corrupted stored bytes: %q %v", bytes, err)
	}
	files, err := NewFileService(db, nil).ListDepots(context.Background(), bucketID)
	if err != nil || len(files) != 1 || files[0].SHA256 != fmt.Sprintf("%x", sha256.Sum256(bytes)) {
		t.Fatalf("metadata mismatch: %+v %v", files, err)
	}
	// Sequential replacement remains supported after the first request finishes.
	if _, err := NewFileService(db, nil).UploadFile(context.Background(), bucketID, "depot", "", "", "same.zip", strings.NewReader("later"), 5); err != nil {
		t.Fatal(err)
	}
}

type signalReader struct {
	io.Reader
	started chan struct{}
}

func (r *signalReader) Read(p []byte) (int, error) {
	if r.started != nil {
		close(r.started)
		r.started = nil
	}
	return r.Reader.Read(p)
}
