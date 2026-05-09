# Deployment Guide

## All-In-One Docker Image

The default deployment uses one image containing:

- Go server
- Built frontend assets
- Redis
- PowerShell
- VMware PowerCLI
- Build scripts

Runtime data is persisted under `/data`.

## Environment

Create an `.env` file next to `docker-compose.yml`:

```env
APP_IMAGE=ghcr.io/kos991/esxi-add:v0.2.0
APP_PORT=8080
DB_PATH=/data/db/esxi-builder.db
CACHE_DIR=/data/builds
STORAGE_TYPE=local
STORAGE_PATH=/data/storage
BUILD_MODE=local
REDIS_URL=redis://127.0.0.1:6379
WORKER_TOKEN=change-this-worker-token
```

## Start

```bash
docker-compose pull
docker-compose up -d
```

Check health:

```bash
curl http://127.0.0.1:8080/health
```

## Update

```bash
docker-compose pull
docker-compose up -d --force-recreate
```
