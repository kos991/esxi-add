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

## Local Image Build

For local development builds, use the override file:

```bash
docker-compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## External Build Worker

The default Docker deployment runs builds inside the all-in-one container:

```env
BUILD_MODE=local
```

Use external mode only when PowerCLI should run outside Docker:

```env
BUILD_MODE=external
WORKER_TOKEN=change-this-worker-token
```

Run the worker on a machine with PowerShell and VMware PowerCLI ImageBuilder:

```powershell
pwsh -File .\scripts\external-build-worker.ps1 `
  -ApiBaseUrl http://192.168.0.142:8080 `
  -WorkerToken change-this-worker-token `
  -WorkDir D:\esxi-worker
```

The worker claims pending build tasks, downloads Depot and driver files through
the API, runs `scripts/build-esxi-iso.ps1`, and uploads the generated ISO back
to the configured storage bucket.
