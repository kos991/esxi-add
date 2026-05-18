package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/viper"
)

const defaultConfigPath = "configs/config.yaml"

type Config struct {
	Server   ServerConfig   `mapstructure:"server"`
	Database DatabaseConfig `mapstructure:"database"`
	Storage  StorageConfig  `mapstructure:"storage"`
	Build    BuildConfig    `mapstructure:"build"`
	Queue    QueueConfig    `mapstructure:"queue"`
	Redis    RedisConfig    `mapstructure:"redis"`
}

type ServerConfig struct {
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
}

type DatabaseConfig struct {
	Path string `mapstructure:"path"`
}

type StorageConfig struct {
	Type      string   `mapstructure:"type"`
	LocalPath string   `mapstructure:"local_path"`
	S3        S3Config `mapstructure:"s3"`
}

type S3Config struct {
	Endpoint     string `mapstructure:"endpoint"`
	AccessKey    string `mapstructure:"access_key"`
	SecretKey    string `mapstructure:"secret_key"`
	BucketName   string `mapstructure:"bucket_name"`
	Region       string `mapstructure:"region"`
	UseSSL       bool   `mapstructure:"use_ssl"`
	PublicDomain string `mapstructure:"public_domain"`
}

type BuildConfig struct {
	Mode           string `mapstructure:"mode"`
	WorkDir        string `mapstructure:"work_dir"`
	PowerShellPath string `mapstructure:"powershell_path"`
	ScriptPath     string `mapstructure:"script_path"`
	MaxConcurrent  int    `mapstructure:"max_concurrent"`
	WorkerToken    string `mapstructure:"worker_token"`
}

type QueueConfig struct {
	Concurrency int `mapstructure:"concurrency"`
}

type RedisConfig struct {
	Addr     string `mapstructure:"addr"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

func Load() (*Config, error) {
	v := viper.New()
	v.SetConfigFile(defaultConfigPath)
	v.SetConfigType("yaml")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	setDefaults(v)
	if err := bindEnvAliases(v); err != nil {
		return nil, err
	}

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}
	applyRedisURL(&cfg)

	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.port", 8080)
	v.SetDefault("database.path", "./data/esxi-builder.db")
	v.SetDefault("storage.type", "local")
	v.SetDefault("storage.local_path", "./data/storage")
	v.SetDefault("storage.s3.use_ssl", true)
	v.SetDefault("storage.s3.region", "us-east-1")
	v.SetDefault("build.mode", "local")
	v.SetDefault("build.work_dir", "./data/builds")
	v.SetDefault("build.powershell_path", "pwsh")
	v.SetDefault("build.script_path", "./scripts/build-esxi-iso.ps1")
	v.SetDefault("build.max_concurrent", 3)
	v.SetDefault("build.worker_token", "")
	v.SetDefault("queue.concurrency", 2)
	v.SetDefault("redis.addr", "redis:6379")
	v.SetDefault("redis.password", "")
	v.SetDefault("redis.db", 0)
}

func bindEnvAliases(v *viper.Viper) error {
	aliases := map[string][]string{
		"server.port":              {"PORT"},
		"database.path":            {"DB_PATH"},
		"storage.type":             {"STORAGE_TYPE"},
		"storage.local_path":       {"STORAGE_PATH"},
		"storage.s3.endpoint":      {"DEFAULT_S3_ENDPOINT"},
		"storage.s3.access_key":    {"DEFAULT_S3_ACCESS_KEY"},
		"storage.s3.secret_key":    {"DEFAULT_S3_SECRET_KEY"},
		"storage.s3.bucket_name":   {"DEFAULT_S3_BUCKET"},
		"storage.s3.region":        {"DEFAULT_S3_REGION"},
		"storage.s3.use_ssl":       {"DEFAULT_S3_USE_SSL"},
		"storage.s3.public_domain": {"DEFAULT_S3_PUBLIC_DOMAIN"},
		"build.mode":               {"BUILD_MODE"},
		"build.work_dir":           {"CACHE_DIR"},
		"build.worker_token":       {"WORKER_TOKEN"},
	}

	for key, envNames := range aliases {
		canonical := strings.ToUpper(strings.ReplaceAll(key, ".", "_"))
		names := append([]string{canonical}, envNames...)
		args := append([]string{key}, names...)
		if err := v.BindEnv(args...); err != nil {
			return fmt.Errorf("bind env %s: %w", key, err)
		}
	}
	return nil
}

func applyRedisURL(cfg *Config) {
	rawURL := os.Getenv("REDIS_URL")
	if rawURL == "" {
		return
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return
	}
	if parsed.Host != "" {
		cfg.Redis.Addr = parsed.Host
	}
	if password, ok := parsed.User.Password(); ok {
		cfg.Redis.Password = password
	}
	if parsed.Path != "" && parsed.Path != "/" {
		db, err := strconv.Atoi(strings.TrimPrefix(parsed.Path, "/"))
		if err == nil {
			cfg.Redis.DB = db
		}
	}
}
