package storage

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/minio/minio-go/v7"
)

type LocalStore struct {
	root string
}

func NewLocalStore(root string) (*LocalStore, error) {
	if strings.TrimSpace(root) == "" {
		return nil, fmt.Errorf("local path is required")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve local path: %w", err)
	}
	if err := os.MkdirAll(absRoot, 0o755); err != nil {
		return nil, fmt.Errorf("create local storage path: %w", err)
	}
	return &LocalStore{root: absRoot}, nil
}

func (s *LocalStore) Upload(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) error {
	_ = size
	_ = contentType

	localPath, err := s.safePath(objectName)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return fmt.Errorf("create local object directory: %w", err)
	}

	tempPath := localPath + ".tmp"
	out, err := os.Create(tempPath)
	if err != nil {
		return fmt.Errorf("create local temp object: %w", err)
	}
	copyErr := func() error {
		defer out.Close()
		if _, err := io.Copy(out, reader); err != nil {
			return fmt.Errorf("write local object: %w", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			return nil
		}
	}()
	if copyErr != nil {
		_ = os.Remove(tempPath)
		return copyErr
	}

	if err := os.Rename(tempPath, localPath); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("move local object into place: %w", err)
	}
	return nil
}

func (s *LocalStore) DeleteObject(ctx context.Context, objectName string) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	localPath, err := s.safePath(objectName)
	if err != nil {
		return err
	}
	if err := os.Remove(localPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete local object %s: %w", objectName, err)
	}
	return nil
}

func (s *LocalStore) RenameObject(ctx context.Context, oldObjectName, newObjectName string) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	oldPath, err := s.safePath(oldObjectName)
	if err != nil {
		return err
	}
	newPath, err := s.safePath(newObjectName)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
		return fmt.Errorf("create renamed object directory: %w", err)
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return fmt.Errorf("rename local object %s to %s: %w", oldObjectName, newObjectName, err)
	}
	return nil
}

func (s *LocalStore) GetObjectInfo(ctx context.Context, objectName string) (minio.ObjectInfo, error) {
	select {
	case <-ctx.Done():
		return minio.ObjectInfo{}, ctx.Err()
	default:
	}

	localPath, err := s.safePath(objectName)
	if err != nil {
		return minio.ObjectInfo{}, err
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return minio.ObjectInfo{}, fmt.Errorf("stat local object %s: %w", objectName, err)
	}
	if info.IsDir() {
		return minio.ObjectInfo{}, fmt.Errorf("local object %s is a directory", objectName)
	}
	return minio.ObjectInfo{
		Key:          cleanObjectName(objectName),
		Size:         info.Size(),
		LastModified: info.ModTime(),
		ETag:         localETag(localPath),
	}, nil
}

func (s *LocalStore) ListObjects(ctx context.Context, prefix string) ([]minio.ObjectInfo, error) {
	startPath, err := s.safePath(prefix)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(startPath); os.IsNotExist(err) {
		return []minio.ObjectInfo{}, nil
	}

	objects := make([]minio.ObjectInfo, 0)
	err = filepath.Walk(startPath, func(currentPath string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(s.root, currentPath)
		if err != nil {
			return err
		}
		objects = append(objects, minio.ObjectInfo{
			Key:          filepath.ToSlash(rel),
			Size:         info.Size(),
			LastModified: info.ModTime(),
			ETag:         localETag(currentPath),
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("list local objects for prefix %s: %w", prefix, err)
	}
	return objects, nil
}

func (s *LocalStore) ResolvePath(objectName string) (string, error) {
	localPath, err := s.safePath(objectName)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return "", fmt.Errorf("stat local object %s: %w", objectName, err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("local object %s is a directory", objectName)
	}
	return localPath, nil
}

func (s *LocalStore) EnsureFile(ctx context.Context, objectName string) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
	}
	return s.ResolvePath(objectName)
}

func (s *LocalStore) TestConnection(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	if err := os.MkdirAll(s.root, 0o755); err != nil {
		return fmt.Errorf("create local storage path: %w", err)
	}
	tempFile, err := os.CreateTemp(s.root, ".write-test-*")
	if err != nil {
		return fmt.Errorf("test local storage write: %w", err)
	}
	tempName := tempFile.Name()
	_ = tempFile.Close()
	_ = os.Remove(tempName)
	return nil
}

func (s *LocalStore) safePath(objectName string) (string, error) {
	cleanName := cleanObjectName(objectName)
	if cleanName == "" || cleanName == "." {
		return s.root, nil
	}
	if filepath.IsAbs(cleanName) || cleanName == ".." || strings.HasPrefix(cleanName, "../") {
		return "", fmt.Errorf("invalid local object path: %s", objectName)
	}

	localPath := filepath.Join(s.root, filepath.FromSlash(cleanName))
	absPath, err := filepath.Abs(localPath)
	if err != nil {
		return "", fmt.Errorf("resolve local object path: %w", err)
	}
	rel, err := filepath.Rel(s.root, absPath)
	if err != nil {
		return "", fmt.Errorf("check local object path: %w", err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("local object path escapes storage root: %s", objectName)
	}
	return absPath, nil
}

func cleanObjectName(objectName string) string {
	normalized := strings.ReplaceAll(strings.TrimSpace(objectName), "\\", "/")
	return strings.TrimPrefix(filepath.ToSlash(filepath.Clean(normalized)), "./")
}

func localETag(localPath string) string {
	file, err := os.Open(localPath)
	if err != nil {
		return ""
	}
	defer file.Close()
	hasher := md5.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return ""
	}
	return hex.EncodeToString(hasher.Sum(nil))
}
