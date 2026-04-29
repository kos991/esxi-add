package utils

import (
    "go.uber.org/zap"
    "go.uber.org/zap/zapcore"
)

var Logger *zap.Logger

func InitLogger() error {
    cfg := zap.NewProductionConfig()
    cfg.EncoderConfig.TimeKey = "timestamp"
    cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder

    logger, err := cfg.Build()
    if err != nil {
        return err
    }

    Logger = logger
    return nil
}
