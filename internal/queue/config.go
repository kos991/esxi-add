package queue

import "github.com/hibiken/asynq"

type Config struct {
	RedisAddr     string
	RedisPassword string
	RedisDB       int
	Concurrency   int
}

func NewClient(cfg Config) *asynq.Client {
	return asynq.NewClient(asynq.RedisClientOpt{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
}

func NewServer(cfg Config) *asynq.Server {
	return asynq.NewServer(
		asynq.RedisClientOpt{Addr: cfg.RedisAddr, Password: cfg.RedisPassword, DB: cfg.RedisDB},
		asynq.Config{
			Concurrency: cfg.Concurrency,
			Queues:      map[string]int{"critical": 6, "default": 3, "low": 1},
		},
	)
}
