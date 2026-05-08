package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
)

const (
	CacheStatusCached  = "cached"
	CacheStatusMissing = "missing"
	CacheStatusStale   = "stale"
	CacheStatusInvalid = "invalid"
)

type CacheFileStatus struct {
	Cached bool   `json:"cached"`
	Valid  bool   `json:"cache_valid"`
	Status string `json:"cache_status"`
}

type CacheManager struct {
	cacheDir       string
	s3Client       *S3Client
	getObjectInfo  func(ctx context.Context, objectPath string) (minio.ObjectInfo, error)
	downloadObject func(ctx context.Context, objectPath string) (io.ReadCloser, error)
}

func NewCacheManager(cacheDir string, s3 *S3Client) *CacheManager {
	manager := &CacheManager{cacheDir: cacheDir, s3Client: s3}
	manager.getObjectInfo = manager.getInfoFromS3
	manager.downloadObject = manager.downloadFromS3
	return manager
}

func (c *CacheManager) Status(objectPath string, objectInfo minio.ObjectInfo) (CacheFileStatus, error) {
	localPath := filepath.Join(c.cacheDir, filepath.FromSlash(objectPath))
	info, err := os.Stat(localPath)
	if err != nil {
		if os.IsNotExist(err) {
			return CacheFileStatus{Status: CacheStatusMissing}, nil
		}
		return CacheFileStatus{}, fmt.Errorf("stat cache file: %w", err)
	}
	if info.IsDir() {
		return CacheFileStatus{Cached: true, Status: CacheStatusInvalid}, nil
	}

	valid, err := validCachedArchive(localPath, objectPath)
	if err != nil {
		return CacheFileStatus{}, err
	}
	if !valid {
		return CacheFileStatus{Cached: true, Status: CacheStatusInvalid}, nil
	}

	etagPath := localPath + ".etag"
	cachedETag, err := os.ReadFile(etagPath)
	if err != nil || strings.TrimSpace(string(cachedETag)) != objectInfo.ETag {
		return CacheFileStatus{Cached: true, Valid: true, Status: CacheStatusStale}, nil
	}

	return CacheFileStatus{Cached: true, Valid: true, Status: CacheStatusCached}, nil
}

func (c *CacheManager) EnsureFile(ctx context.Context, s3Path string) (localPath string, err error) {
	if c.getObjectInfo == nil || c.downloadObject == nil {
		return "", fmt.Errorf("s3 client is not configured")
	}

	localPath = filepath.Join(c.cacheDir, filepath.FromSlash(s3Path))
	etagPath := localPath + ".etag"

	objectInfo, err := c.getObjectInfo(ctx, s3Path)
	if err != nil {
		return "", err
	}

	if _, err := os.Stat(localPath); err == nil {
		cachedETag, readErr := os.ReadFile(etagPath)
		valid, validErr := validCachedArchive(localPath, s3Path)
		if validErr != nil {
			return "", validErr
		}
		if valid && readErr == nil && strings.TrimSpace(string(cachedETag)) == objectInfo.ETag {
			return localPath, nil
		}
	}

	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return "", fmt.Errorf("create cache directory: %w", err)
	}

	reader, err := c.downloadObject(ctx, s3Path)
	if err != nil {
		return "", err
	}
	defer reader.Close()

	tempPath := localPath + ".tmp"
	out, err := os.Create(tempPath)
	if err != nil {
		return "", fmt.Errorf("create temp cache file: %w", err)
	}

	copyErr := func() error {
		defer out.Close()
		if _, err := io.Copy(out, reader); err != nil {
			return fmt.Errorf("write cache file: %w", err)
		}
		return nil
	}()
	if copyErr != nil {
		_ = os.Remove(tempPath)
		return "", copyErr
	}

	if err := os.Remove(localPath); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(tempPath)
		return "", fmt.Errorf("remove stale cache file: %w", err)
	}

	if err := os.Rename(tempPath, localPath); err != nil {
		_ = os.Remove(tempPath)
		return "", fmt.Errorf("move cache file into place: %w", err)
	}

	if err := os.WriteFile(etagPath, []byte(objectInfo.ETag), 0o644); err != nil {
		return "", fmt.Errorf("write etag sidecar: %w", err)
	}

	return localPath, nil
}

func (c *CacheManager) getInfoFromS3(ctx context.Context, objectPath string) (minio.ObjectInfo, error) {
	if c.s3Client == nil {
		return minio.ObjectInfo{}, fmt.Errorf("s3 client is not configured")
	}
	return c.s3Client.GetObjectInfo(ctx, objectPath)
}

func (c *CacheManager) downloadFromS3(ctx context.Context, objectPath string) (io.ReadCloser, error) {
	if c.s3Client == nil {
		return nil, fmt.Errorf("s3 client is not configured")
	}
	return c.s3Client.Download(ctx, objectPath)
}

func validCachedArchive(localPath, objectPath string) (bool, error) {
	ext := strings.ToLower(filepath.Ext(objectPath))
	if ext != ".zip" && ext != ".vib" {
		return true, nil
	}

	file, err := os.Open(localPath)
	if err != nil {
		return false, fmt.Errorf("open cache file: %w", err)
	}
	defer file.Close()

	header := make([]byte, 8)
	n, err := io.ReadFull(file, header)
	if err != nil && err != io.ErrUnexpectedEOF {
		return false, fmt.Errorf("read cache file: %w", err)
	}
	header = header[:n]

	switch ext {
	case ".zip":
		return bytes.HasPrefix(header, []byte("PK\x03\x04")) ||
			bytes.HasPrefix(header, []byte("PK\x05\x06")) ||
			bytes.HasPrefix(header, []byte("PK\x07\x08")), nil
	case ".vib":
		return bytes.HasPrefix(header, []byte("!<arch>\n")), nil
	default:
		return true, nil
	}
}

func (c *CacheManager) CleanOldFiles(maxAgeDays int) error {
	cutoff := time.Now().Add(-time.Duration(maxAgeDays) * 24 * time.Hour)

	return filepath.Walk(c.cacheDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		if info.ModTime().After(cutoff) {
			return nil
		}

		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove cache file %s: %w", path, err)
		}

		if !strings.HasSuffix(path, ".etag") {
			if err := os.Remove(path + ".etag"); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("remove etag sidecar %s: %w", path+".etag", err)
			}
		}
		return nil
	})
}

func (c *CacheManager) GetCacheSize() (int64, error) {
	var total int64

	err := filepath.Walk(c.cacheDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		total += info.Size()
		return nil
	})
	if err != nil {
		return 0, err
	}

	return total, nil
}
