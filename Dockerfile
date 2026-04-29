# Build stage
FROM golang:1.21-bookworm AS builder
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends git gcc libc6-dev libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go mod tidy && CGO_ENABLED=1 GOOS=linux go build -o /app/server ./cmd/server

# Runtime stage
FROM mcr.microsoft.com/powershell:7.4-debian-12
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsqlite3-0 ca-certificates tzdata curl \
    && rm -rf /var/lib/apt/lists/*
# Install VMware PowerCLI
RUN pwsh -Command "Set-PSRepository PSGallery -InstallationPolicy Trusted; Install-Module -Name VMware.PowerCLI -Force -AllowClobber -Scope AllUsers"
WORKDIR /app
COPY --from=builder /app/server /usr/local/bin/server
COPY scripts/ ./scripts/
COPY configs/ ./configs/
RUN mkdir -p /data /cache
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:8080/health || exit 1
CMD ["server"]
