package config

import (
    "fmt"
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
    Endpoint   string `mapstructure:"endpoint"`
    AccessKey  string `mapstructure:"access_key"`
    SecretKey  string `mapstructure:"secret_key"`
    BucketName string `mapstructure:"bucket_name"`
    Region     string `mapstructure:"region"`
    UseSSL     bool   `mapstructure:"use_ssl"`
}

type BuildConfig struct {
    WorkDir       string `mapstructure:"work_dir"`
    PowerShellPath string `mapstructure:"powershell_path"`
    ScriptPath    string `mapstructure:"script_path"`
    MaxConcurrent int    `mapstructure:"max_concurrent"`
}

type QueueConfig struct {
    Concurrency   int    `mapstructure:"concurrency"`
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

    if err := v.ReadInConfig(); err != nil {
        return nil, fmt.Errorf("read config: %w", err)
    }

    var cfg Config
    if err := v.Unmarshal(&cfg); err != nil {
        return nil, fmt.Errorf("unmarshal config: %w", err)
    }

    return &cfg, nil
}

func setDefaults(v *viper.Viper) {
    v.SetDefault("server.host", "0.0.0.0")
    v.SetDefault("server.port", 8080)
    v.SetDefault("database.path", "./data/esxi-builder.db")
    v.SetDefault("storage.type", "local")
    v.SetDefault("storage.local_path", "./data/storage")
    v.SetDefault("storage.s3.use_ssl", true)
    v.SetDefault("build.work_dir", "./data/builds")
    v.SetDefault("build.powershell_path", "pwsh")
    v.SetDefault("build.script_path", "./scripts/build-esxi-iso.ps1")
    v.SetDefault("build.max_concurrent", 3)
    v.SetDefault("queue.concurrency", 2)
    v.SetDefault("redis.addr", "redis:6379")
    v.SetDefault("redis.password", "")
    v.SetDefault("redis.db", 0)
}
