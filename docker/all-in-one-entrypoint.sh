#!/bin/sh
set -eu

log() {
	printf '%s %s\n' "$(date -Iseconds)" "$*"
}

export PORT="${PORT:-8080}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export DB_PATH="${DB_PATH:-/data/db/esxi-builder.db}"
export STORAGE_TYPE="${STORAGE_TYPE:-local}"
export STORAGE_PATH="${STORAGE_PATH:-/data/storage}"
export CACHE_DIR="${CACHE_DIR:-/data/builds}"
export FRONTEND_DIST_DIR="${FRONTEND_DIST_DIR:-/app/frontend/dist}"

export MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
export MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
export DEFAULT_S3_ENDPOINT="${DEFAULT_S3_ENDPOINT:-127.0.0.1:9000}"
export DEFAULT_S3_ACCESS_KEY="${DEFAULT_S3_ACCESS_KEY:-$MINIO_ROOT_USER}"
export DEFAULT_S3_SECRET_KEY="${DEFAULT_S3_SECRET_KEY:-$MINIO_ROOT_PASSWORD}"
export DEFAULT_S3_BUCKET="${DEFAULT_S3_BUCKET:-esxi-builder}"
export DEFAULT_S3_REGION="${DEFAULT_S3_REGION:-us-east-1}"
export DEFAULT_S3_USE_SSL="${DEFAULT_S3_USE_SSL:-false}"
export DEFAULT_S3_PUBLIC_DOMAIN="${DEFAULT_S3_PUBLIC_DOMAIN:-http://localhost:9000}"

mkdir -p /data/db /data/storage /data/builds /data/minio /data/redis

redis_pid=""
minio_pid=""
server_pid=""

cleanup() {
	for pid in "$server_pid" "$minio_pid" "$redis_pid"; do
		if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
			kill "$pid" 2>/dev/null || true
		fi
	done
	wait "$server_pid" 2>/dev/null || true
	wait "$minio_pid" 2>/dev/null || true
	wait "$redis_pid" 2>/dev/null || true
}

shutdown() {
	log "shutdown requested"
	cleanup
	exit 0
}

wait_for_redis() {
	i=0
	while [ "$i" -lt 30 ]; do
		if redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
			return 0
		fi
		i=$((i + 1))
		sleep 1
	done
	return 1
}

wait_for_minio() {
	i=0
	while [ "$i" -lt 60 ]; do
		if curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
			return 0
		fi
		i=$((i + 1))
		sleep 1
	done
	return 1
}

trap shutdown INT TERM

log "starting redis"
redis-server \
	--bind 127.0.0.1 \
	--port 6379 \
	--dir /data/redis \
	--appendonly yes \
	--protected-mode no &
redis_pid="$!"

if ! wait_for_redis; then
	log "redis did not become ready"
	cleanup
	exit 1
fi

log "starting minio"
minio server /data/minio --address ":9000" --console-address ":9001" &
minio_pid="$!"

if ! wait_for_minio; then
	log "minio did not become ready"
	cleanup
	exit 1
fi

log "starting app server"
server &
server_pid="$!"

set +e
wait "$server_pid"
status="$?"
set -e

cleanup
exit "$status"
