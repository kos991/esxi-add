package storage

import (
    "context"
    "fmt"
    "io"
    "os"
    "path/filepath"
    "strings"
    "time"
)

type CacheManager struct {
    cacheDir string
    s3Client *S3Client
}

func NewCacheManager(cacheDir string, s3 *S3Client) *CacheManager {
    return &CacheManager{cacheDir: cacheDir, s3Client: s3}
}

func (c *CacheManager) EnsureFile(ctx context.Context, s3Path string) (localPath string, err error) {
    if c.s3Client == nil {
        return "", fmt.Errorf("s3 client is not configured")
    }

    localPath = filepath.Join(c.cacheDir, filepath.FromSlash(s3Path))
    etagPath := localPath + ".etag"

    objectInfo, err := c.s3Client.GetObjectInfo(ctx, s3Path)
    if err != nil {
        return "", err
    }

    if _, err := os.Stat(localPath); err == nil {
        cachedETag, readErr := os.ReadFile(etagPath)
        if readErr == nil && strings.TrimSpace(string(cachedETag)) == objectInfo.ETag {
            return localPath, nil
        }
    }

    if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
        return "", fmt.Errorf("create cache directory: %w", err)
    }

    reader, err := c.s3Client.Download(ctx, s3Path)
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
