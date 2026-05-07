# Frontend build stage
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Backend build stage
FROM golang:1.21-bookworm AS backend-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build -o /out/server ./cmd/server

# Single-image runtime: Go app + built frontend + Redis + PowerCLI build tooling.
FROM mcr.microsoft.com/powershell:7.4-debian-12

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl python3 python3-pip redis-server tzdata \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --break-system-packages --no-cache-dir lxml psutil pyopenssl six \
    && pwsh -NoLogo -NoProfile -Command "Set-PSRepository PSGallery -InstallationPolicy Trusted; Install-Module -Name VMware.PowerCLI -Force -AllowClobber -Scope AllUsers; Set-PowerCLIConfiguration -Scope AllUsers -ParticipateInCEIP `$false -InvalidCertificateAction Ignore -Confirm:`$false | Out-Null"

WORKDIR /app
COPY --from=backend-builder /out/server /usr/local/bin/server
COPY --from=frontend-builder /frontend/dist/ /app/frontend/dist/
COPY scripts/ ./scripts/
COPY configs/ ./configs/
COPY docker/all-in-one-entrypoint.sh /usr/local/bin/all-in-one-entrypoint
RUN chmod +x /usr/local/bin/all-in-one-entrypoint \
    && mkdir -p /data/db /data/storage /data/builds /data/redis

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -f http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/usr/local/bin/all-in-one-entrypoint"]
