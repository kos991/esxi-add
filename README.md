# ESXi ISO Builder

Current release: `v0.2.0`

Custom ESXi ISO build platform with:

- Go backend
- React + Vite frontend
- Local disk storage and optional external S3-compatible buckets
- Asynq async build queue
- PowerShell/PowerCLI build execution inside the all-in-one container or through an external worker
- WebSocket log streaming
- Single-image Docker Compose deployment

## Project Structure

```text
cmd/server                Backend entrypoint
internal/config           App configuration
internal/database         GORM database bootstrap
internal/models           Core data models
internal/storage          S3 client + cache manager
internal/services         File service layer
internal/queue            Asynq tasks + worker handler
internal/builder          PowerShell build executor
internal/websocket        WebSocket manager
frontend/                 React frontend
scripts/                  PowerShell build scripts
configs/                  YAML config
```

## Main Features

### Backend
- Storage bucket management
- Depot / driver / ISO file management
- Build task creation and tracking
- WebSocket build log streaming
- Redis-backed async worker

### Frontend
- Bucket management UI
- File upload / listing UI
- Build creation wizard
- Task list and task detail pages

### Deployment
- One Docker image containing the Go server, built frontend, Redis, PowerShell, and VMware PowerCLI
- SQLite database and runtime data persisted under `/data`
- The all-in-one image includes PowerShell and VMware PowerCLI for local build mode
- External build mode can still keep PowerShell/PowerCLI on a separate worker machine

## Local Development

### Backend
```bash
go run ./cmd/server
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Docker

### Quick Start

Create an `.env` file or export these variables before starting the service:

```env
APP_IMAGE=ghcr.io/kos991/esxi-add:v0.2.0
APP_PORT=8080
STORAGE_TYPE=local
STORAGE_PATH=/data/storage
CACHE_DIR=/data/builds
BUILD_MODE=local
```

Start the all-in-one container:

```bash
docker-compose pull
docker-compose up -d
```

The app UI and API are served from:

```bash
http://localhost:8080
```

For local image development, build with the override file:

```bash
docker-compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### Basic Usage

1. Open `http://localhost:8080`.
2. Go to **Storage & Assets** and confirm the default local storage node, or add an S3-compatible/R2 node.
3. Upload Depot files and driver bundles, or click refresh after placing files in the configured storage path.
4. Open **Custom Build**, select the target ESXi version, then choose a Depot from the mixed storage node list.
5. Select optional drivers and run the download validation step. The build button is enabled only after validation succeeds.
6. Start the ISO build and watch logs/progress from the task detail page.
7. After completion, download the ISO from the local API button, or use the remote public URL button when the storage node has a public domain configured.

Recommended storage layout for local files:

```text
/data/storage/
  depot/6x/ESXi670-202210001.zip
  depot/8x/VMware-ESXi-8.0U3w-24784741-depot.zip
  driver/8x/network/net-driver-offline_bundle.zip
  output/custom-esxi.iso
```

## External Build Worker

The default Docker deployment runs builds inside the all-in-one container:

```env
BUILD_MODE=local
```

Set the server to external mode only when a separate PowerCLI worker should
claim build tasks through the API:

```env
BUILD_MODE=external
WORKER_TOKEN=change-this-worker-token
```

Run the worker on a separate machine that has PowerShell and VMware PowerCLI
ImageBuilder available:

```powershell
pwsh -File .\scripts\external-build-worker.ps1 `
  -ApiBaseUrl http://192.168.0.142:8080 `
  -WorkerToken change-this-worker-token `
  -WorkDir D:\esxi-worker
```

The worker claims pending build tasks, downloads depot and driver files through
the API, runs `scripts/build-esxi-iso.ps1`, and uploads the generated ISO back to
the configured storage bucket. S3/R2 credentials remain on the server.

## CI

GitHub Actions validates:

- backend dependency resolution
- `go vet ./...`
- `go build ./...`
- frontend dependency install
- frontend production build
- single Docker image build and GHCR publish on `main`

## Release

The prepared release version is stored in `VERSION` and mirrored in
`frontend/package.json`. Push a `v*` tag, for example `v0.2.0`, to publish a
matching GHCR image tag in addition to `latest`, `main`, and the commit SHA.

## Environment

See:

- `.env.example`
- `configs/config.yaml`

## Notes

- Frontend assets are built in the main Dockerfile and served by the Go server
- Redis, SQLite, uploaded files, and build/cache data share the `/data` volume in Docker
- PowerShell/PowerCLI are installed in the all-in-one image for `BUILD_MODE=local`
- In `BUILD_MODE=external`, local PowerShell execution is disabled and builds wait for an external worker
- Bucket-specific S3 clients are supported at runtime
