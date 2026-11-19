# syntax=docker/dockerfile:1
# Frontend build stage
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,id=esxi-npm,target=/root/.npm,sharing=locked npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Backend build stage
FROM golang:1.22-bookworm AS backend-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN --mount=type=cache,id=esxi-go-mod,target=/go/pkg/mod,sharing=locked go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
ARG TARGETARCH
RUN --mount=type=cache,id=esxi-go-mod,target=/go/pkg/mod,sharing=locked \
    --mount=type=cache,id=esxi-go-build,target=/root/.cache/go-build,sharing=locked \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build -mod=readonly -o /out/server ./cmd/server

# Single-image runtime: Go app + built frontend + Redis + pinned VMware PowerCLI ImageBuilder.
FROM vmware/powerclicore:latest

ARG APP_VERSION=v1.0.1
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="ESXi ISO Builder" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/kos991/esxi-add"

RUN if command -v apt-get >/dev/null 2>&1; then \
        apt-get update \
        && apt-get install -y --no-install-recommends ca-certificates curl redis-server tzdata xorriso p7zip-full \
        && rm -rf /var/lib/apt/lists/*; \
    elif command -v tdnf >/dev/null 2>&1; then \
        tdnf install -y ca-certificates curl python3-pip redis tzdata \
        && tdnf clean all; \
    else \
        echo "unsupported PowerCLI runtime package manager" >&2; \
        exit 1; \
    fi

RUN python3 -m pip install --no-cache-dir lxml psutil pyopenssl six

# 统一 UTF-8，避免脚本中文输出在容器内变成 ??
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

WORKDIR /app
COPY --from=backend-builder /out/server /usr/local/bin/server
COPY --from=frontend-builder /frontend/dist/ /app/frontend/dist/
COPY scripts/ ./scripts/
# 防止脚本以 CRLF 换行进入 Linux 容器（否则 bash 报 $'\r': command not found）
RUN find ./scripts -type f -name '*.sh' -exec sed -i 's/\r$//' {} + \
    && chmod +x ./scripts/*.sh
COPY configs/ ./configs/
COPY docker/all-in-one-entrypoint.sh /usr/local/bin/all-in-one-entrypoint
RUN chmod +x /usr/local/bin/all-in-one-entrypoint \
    && mkdir -p /data/db /data/storage /data/builds /data/redis

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -f http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/usr/local/bin/all-in-one-entrypoint"]
