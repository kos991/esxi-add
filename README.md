# ESXi ISO Builder

Current release: `v0.2.0`

ESXi ISO Builder is a single-image web platform for managing ESXi Depot files,
driver bundles, storage nodes, and custom ISO build tasks.

## Features

- Go backend with React + Vite frontend.
- Local disk storage and optional S3-compatible/R2 storage nodes.
- Mixed-storage Depot discovery in the build wizard.
- Preflight download and ZIP/VIB validation before builds start.
- PowerShell/PowerCLI build execution inside the all-in-one container.
- Optional external PowerCLI worker mode.
- Task history, progress, logs, and ISO download links.

## Quick Start

```bash
docker-compose pull
docker-compose up -d
```

Open:

```text
http://localhost:8080
```

For a pinned release image, set this in `.env` before starting:

```env
APP_IMAGE=ghcr.io/kos991/esxi-add:v0.2.0
```

## Documentation

- [Usage Guide](docs/usage.md)
- [Deployment Guide](docs/deployment.md)
- [Development Guide](docs/development.md)
- [Release Guide](docs/release.md)
- [Changelog](CHANGELOG.md)

## Project Layout

```text
cmd/server                Backend entrypoint
internal/config           App configuration
internal/database         GORM database bootstrap
internal/models           Core data models
internal/storage          S3 and local storage adapters
internal/services         File service layer
internal/queue            Asynq tasks and worker handler
internal/builder          PowerShell build executor
internal/websocket        WebSocket manager
frontend/                 React frontend
scripts/                  PowerShell build scripts
configs/                  YAML config
docker/                   All-in-one runtime entrypoint
docs/                     Project documentation
```

## Version

The release version is stored in `VERSION` and mirrored in
`frontend/package.json`.
