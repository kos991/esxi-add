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
export BUILD_MODE="${BUILD_MODE:-local}"
export WORKER_TOKEN="${WORKER_TOKEN:-}"
export FRONTEND_DIST_DIR="${FRONTEND_DIST_DIR:-/app/frontend/dist}"

mkdir -p /data/db /data/storage /data/builds /data/redis

redis_pid=""
server_pid=""

cleanup() {
	for pid in "$server_pid" "$redis_pid"; do
		if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
			kill "$pid" 2>/dev/null || true
		fi
	done
	wait "$server_pid" 2>/dev/null || true
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

log "starting app server"
server &
server_pid="$!"

set +e
wait "$server_pid"
status="$?"
set -e

cleanup
exit "$status"
