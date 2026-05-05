# ESXi ISO Builder

Custom ESXi ISO build platform with:

- Go backend
- React + Vite frontend
- Local disk storage and optional S3/MinIO buckets
- Asynq async build queue
- PowerShell/PowerCLI build execution through an external worker or host tooling
- WebSocket log streaming
- All-in-one Docker Compose deployment

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
- One Docker image containing the Go server, built frontend, Redis, and MinIO
- SQLite database and runtime data persisted under `/data`
- The all-in-one image intentionally does not include PowerShell or PowerCLI
- External build mode keeps PowerShell/PowerCLI on a separate worker machine

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

```bash
docker-compose build
docker-compose up -d
```

The app UI and API are served from:

```bash
http://localhost:8080
```

MinIO is available at `http://localhost:9000`, with the console at `http://localhost:9001`.

## External Build Worker

Set the server to external mode so the all-in-one container does not try to run
PowerShell or PowerCLI:

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
- all-in-one Docker image build

## Environment

See:

- `.env.example`
- `configs/config.yaml`

## Notes

- Frontend assets are built in the main Dockerfile and served by the Go server
- Redis, MinIO, SQLite, uploaded files, and build/cache data share the `/data` volume in Docker
- PowerShell/PowerCLI are not installed in the all-in-one image
- In `BUILD_MODE=external`, local PowerShell execution is disabled and builds wait for an external worker
- Bucket-specific S3 clients are supported at runtime
