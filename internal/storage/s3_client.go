package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"

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

	ctx := context.Background()
	exists, err := client.BucketExists(ctx, cfg.BucketName)
	if err != nil {
		return nil, fmt.Errorf("check bucket exists: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, cfg.BucketName, minio.MakeBucketOptions{Region: cfg.Region}); err != nil {
			return nil, fmt.Errorf("create bucket: %w", err)
		}
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
	if s.publicDomain == "" {
		return ""
	}
	return strings.TrimRight(s.publicDomain, "/") + "/" + s.bucketName + "/" + strings.TrimLeft(objectName, "/")
}

func (s *S3Client) TestConnection(ctx context.Context) error {
	_, err := s.client.BucketExists(ctx, s.bucketName)
	if err != nil {
		return fmt.Errorf("test s3 connection: %w", err)
	}
	return nil
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
