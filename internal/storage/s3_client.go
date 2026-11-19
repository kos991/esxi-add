package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type S3Client struct {
	client       *minio.Client
	bucketName   string
	publicDomain string
}

func NewS3Client(cfg *S3Config) (*S3Client, error) {
	if cfg == nil {
		return nil, fmt.Errorf("s3 config is nil")
	}
	if cfg.Endpoint == "" {
		return nil, fmt.Errorf("s3 endpoint is required")
	}
	if cfg.BucketName == "" {
		return nil, fmt.Errorf("bucket name is required")
	}

	endpoint, useSSL, err := normalizeS3Endpoint(cfg.Endpoint, cfg.UseSSL)
	if err != nil {
		return nil, err
	}

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure: useSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("create s3 client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	exists, err := client.BucketExists(ctx, cfg.BucketName)
	if err != nil {
		return nil, fmt.Errorf("check bucket exists: %w", err)
	}
	if !exists {
		return nil, fmt.Errorf("存储桶不存在: %s", cfg.BucketName)
	}

	return &S3Client{
		client:       client,
		bucketName:   cfg.BucketName,
		publicDomain: cfg.PublicDomain,
	}, nil
}

func (s *S3Client) Upload(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucketName, objectName, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return fmt.Errorf("upload object %s: %w", objectName, err)
	}
	return nil
}

func (s *S3Client) Download(ctx context.Context, objectName string) (io.ReadCloser, error) {
	object, err := s.client.GetObject(ctx, s.bucketName, objectName, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("download object %s: %w", objectName, err)
	}

	if _, err := object.Stat(); err != nil {
		_ = object.Close()
		return nil, fmt.Errorf("stat downloaded object %s: %w", objectName, err)
	}

	return object, nil
}

func (s *S3Client) GetObjectInfo(ctx context.Context, objectName string) (minio.ObjectInfo, error) {
	info, err := s.client.StatObject(ctx, s.bucketName, objectName, minio.StatObjectOptions{})
	if err != nil {
		return minio.ObjectInfo{}, fmt.Errorf("stat object %s: %w", objectName, err)
	}
	return info, nil
}

func (s *S3Client) ListObjects(ctx context.Context, prefix string) ([]minio.ObjectInfo, error) {
	objects := make([]minio.ObjectInfo, 0)
	for objectInfo := range s.client.ListObjects(ctx, s.bucketName, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}) {
		if objectInfo.Err != nil {
			return nil, fmt.Errorf("list objects for prefix %s: %w", prefix, objectInfo.Err)
		}
		objects = append(objects, objectInfo)
	}
	return objects, nil
}

func (s *S3Client) DeleteObject(ctx context.Context, objectName string) error {
	if err := s.client.RemoveObject(ctx, s.bucketName, objectName, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("delete object %s: %w", objectName, err)
	}
	return nil
}

func (s *S3Client) RenameObject(ctx context.Context, oldObjectName, newObjectName string) error {
	_, err := s.client.CopyObject(ctx,
		minio.CopyDestOptions{Bucket: s.bucketName, Object: newObjectName},
		minio.CopySrcOptions{Bucket: s.bucketName, Object: oldObjectName},
	)
	if err != nil {
		return fmt.Errorf("copy object %s to %s: %w", oldObjectName, newObjectName, err)
	}
	if err := s.DeleteObject(ctx, oldObjectName); err != nil {
		return err
	}
	return nil
}

func (s *S3Client) GetPublicURL(objectName string) string {
	domain := NormalizePublicDomain(s.publicDomain)
	if domain == "" {
		return ""
	}
	return domain + "/" + strings.TrimLeft(strings.TrimSpace(objectName), "/")
}

// GetPresignedDownloadURL generates a temporary signed GET URL for downloading private S3 objects.
func (s *S3Client) GetPresignedDownloadURL(ctx context.Context, objectName string, expires time.Duration, downloadFilename string) (string, error) {
	cleanObject := strings.TrimLeft(strings.TrimSpace(objectName), "/")
	if cleanObject == "" {
		return "", fmt.Errorf("object name is required")
	}
	if expires <= 0 {
		expires = 24 * time.Hour
	}
	if expires > 7*24*time.Hour {
		expires = 7 * 24 * time.Hour
	}

	reqParams := make(url.Values)
	if name := strings.TrimSpace(downloadFilename); name != "" {
		safeName := strings.ReplaceAll(name, `"`, "")
		reqParams.Set("response-content-disposition", fmt.Sprintf(`attachment; filename="%s"`, safeName))
	}

	presignedURL, err := s.client.PresignedGetObject(ctx, s.bucketName, cleanObject, expires, reqParams)
	if err != nil {
		return "", fmt.Errorf("presign object %s: %w", cleanObject, err)
	}
	return presignedURL.String(), nil
}

// NormalizePublicDomain returns an absolute public object host URL.
func NormalizePublicDomain(rawDomain string) string {
	domain := strings.TrimRight(strings.TrimSpace(rawDomain), "/")
	if domain == "" {
		return ""
	}
	if !strings.Contains(domain, "://") {
		return "https://" + domain
	}
	return domain
}

func (s *S3Client) TestConnection(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	exists, err := s.client.BucketExists(ctx, s.bucketName)
	if err != nil {
		return fmt.Errorf("test s3 connection: %w", err)
	}
	if !exists {
		return fmt.Errorf("存储桶不存在: %s", s.bucketName)
	}
	// A list probe demonstrates listing only, never object read/write permission.
	for info := range s.client.ListObjects(ctx, s.bucketName, minio.ListObjectsOptions{MaxKeys: 1}) {
		if info.Err != nil {
			return fmt.Errorf("列举存储桶失败: %w", info.Err)
		}
		return nil
	}
	return ctx.Err()
}

func normalizeS3Endpoint(rawEndpoint string, useSSL bool) (string, bool, error) {
	endpoint := strings.TrimSpace(rawEndpoint)
	if endpoint == "" {
		return "", useSSL, fmt.Errorf("s3 endpoint is required")
	}

	if strings.Contains(endpoint, "://") {
		parsed, err := url.Parse(endpoint)
		if err != nil {
			return "", useSSL, fmt.Errorf("parse s3 endpoint: %w", err)
		}
		if parsed.Host == "" {
			return "", useSSL, fmt.Errorf("s3 endpoint URL must include a host")
		}
		if parsed.Path != "" && parsed.Path != "/" {
			return "", useSSL, fmt.Errorf("s3 endpoint must not include a path; put the bucket name in bucket_name")
		}
		if parsed.RawQuery != "" || parsed.Fragment != "" {
			return "", useSSL, fmt.Errorf("s3 endpoint must not include query or fragment")
		}

		switch parsed.Scheme {
		case "https":
			return parsed.Host, true, nil
		case "http":
			return parsed.Host, false, nil
		default:
			return "", useSSL, fmt.Errorf("unsupported s3 endpoint scheme: %s", parsed.Scheme)
		}
	}

	endpoint = strings.TrimRight(endpoint, "/")
	if strings.Contains(endpoint, "/") {
		return "", useSSL, fmt.Errorf("s3 endpoint must not include a path; put the bucket name in bucket_name")
	}

	return endpoint, useSSL, nil
}
