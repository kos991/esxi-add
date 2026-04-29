# Build stage
FROM golang:1.21-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git gcc musl-dev sqlite-dev
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o /app/server ./cmd/server

# Runtime stage
FROM mcr.microsoft.com/powershell:7.4-alpine-3.19
RUN apk add --no-cache sqlite-libs ca-certificates tzdata curl
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
