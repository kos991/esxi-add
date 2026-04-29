# ESXi ISO Builder

Custom ESXi ISO build platform with:

- Go backend
- React + Vite frontend
- S3/MinIO storage
- Asynq async build queue
- PowerShell/PowerCLI build execution
- WebSocket log streaming
- Docker Compose deployment

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
- Backend Docker image
- Frontend Nginx image
- Compose stack with Redis + MinIO

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

Dev mode:

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## CI

GitHub Actions validates:

- backend dependency resolution
- `go vet ./...`
- `go build ./...`
- frontend dependency install
- frontend production build

## Environment

See:

- `.env.example`
- `configs/config.yaml`

## Notes

- Frontend Docker build expects `frontend/package-lock.json`
- PowerCLI is installed in the backend runtime image
- Bucket-specific S3 clients are supported at runtime
