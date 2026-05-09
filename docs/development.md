# Development Guide

## Backend

```bash
go run ./cmd/server
```

Run checks:

```bash
go test ./...
go vet ./...
go build ./...
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Build frontend:

```bash
npm run build
```

## Docker

Build local all-in-one image:

```bash
docker-compose -f docker-compose.yml -f docker-compose.build.yml build
```

Start local build:

```bash
docker-compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Test Scope

The repository keeps tests for backend handlers, storage adapters, database
migrations, queue workers, PowerShell build script behavior, Docker runtime
assumptions, and upload limits.

Brittle frontend source-string tests were removed. Frontend verification is
currently TypeScript plus production build.
