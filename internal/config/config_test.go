package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadSupportsDeploymentEnvAliases(t *testing.T) {
	tempDir := t.TempDir()
	configDir := filepath.Join(tempDir, "configs")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("create config dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte("{}\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	originalWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(originalWD)
	})

	t.Setenv("PORT", "9090")
	t.Setenv("DB_PATH", "/data/custom.db")
	t.Setenv("CACHE_DIR", "/cache/builds")
	t.Setenv("REDIS_URL", "redis://:secret@redis.internal:6380/2")
	t.Setenv("DEFAULT_S3_ENDPOINT", "minio:9000")
	t.Setenv("DEFAULT_S3_ACCESS_KEY", "minioadmin")
	t.Setenv("DEFAULT_S3_SECRET_KEY", "miniosecret")
	t.Setenv("DEFAULT_S3_BUCKET", "esxi-builder")
	t.Setenv("DEFAULT_S3_REGION", "us-east-1")
	t.Setenv("DEFAULT_S3_USE_SSL", "false")
	t.Setenv("DEFAULT_S3_PUBLIC_DOMAIN", "http://localhost:9000")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Server.Port != 9090 {
		t.Fatalf("expected PORT alias to set server port, got %d", cfg.Server.Port)
	}
	if cfg.Database.Path != "/data/custom.db" {
		t.Fatalf("expected DB_PATH alias, got %q", cfg.Database.Path)
	}
	if cfg.Build.WorkDir != "/cache/builds" {
		t.Fatalf("expected CACHE_DIR alias, got %q", cfg.Build.WorkDir)
	}
	if cfg.Redis.Addr != "redis.internal:6380" || cfg.Redis.Password != "secret" || cfg.Redis.DB != 2 {
		t.Fatalf("expected REDIS_URL to populate redis settings, got addr=%q password=%q db=%d", cfg.Redis.Addr, cfg.Redis.Password, cfg.Redis.DB)
	}
	if cfg.Storage.S3.Endpoint != "minio:9000" ||
		cfg.Storage.S3.AccessKey != "minioadmin" ||
		cfg.Storage.S3.SecretKey != "miniosecret" ||
		cfg.Storage.S3.BucketName != "esxi-builder" ||
		cfg.Storage.S3.Region != "us-east-1" ||
		cfg.Storage.S3.UseSSL ||
		cfg.Storage.S3.PublicDomain != "http://localhost:9000" {
		t.Fatalf("default s3 aliases were not loaded: %+v", cfg.Storage.S3)
	}
}
