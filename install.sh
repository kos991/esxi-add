#!/bin/sh
# ESXi ISO Builder - 一键部署脚本
# 用法:  curl -fsSL https://raw.githubusercontent.com/kos991/esxi-add/main/install.sh | sh
#        或 ./install.sh            (使用已有镜像 / 自动拉取)
#        APP_PORT=9090 ./install.sh (自定义端口)
set -eu

IMAGE="${APP_IMAGE:-ghcr.io/kos991/esxi-add:latest}"
NAME="${APP_NAME:-esxi-iso-builder}"
PORT="${APP_PORT:-8080}"
VOLUME="${APP_VOLUME:-esxi-data}"

say() { printf '\033[1;34m[esxi-builder]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[esxi-builder] %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未检测到 docker，请先安装 Docker"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  say "拉取镜像 $IMAGE ..."
  docker pull "$IMAGE" || die "拉取失败，可先用: docker load -i esxi-iso-builder.tar.gz"
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  say "发现旧容器 $NAME，数据卷 $VOLUME 会保留，重新创建..."
  docker rm -f "$NAME" >/dev/null
fi

say "启动容器 $NAME (端口 $PORT)..."
docker run -d --name "$NAME" \
  --restart unless-stopped \
  -p "$PORT:8080" \
  -v "$VOLUME:/data" \
  --tmpfs /tmp:size=3G,mode=1777 \
  -e SERVER_HOST=0.0.0.0 \
  -e PORT=8080 \
  -e CACHE_DIR=/tmp/builds \
  -e TMPDIR=/tmp \
  -e API_TOKEN="${API_TOKEN:-}" \
  "$IMAGE" >/dev/null

say "等待服务就绪..."
i=0
while [ "$i" -lt 60 ]; do
  if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    say "部署完成！浏览器打开:  http://<本机IP>:$PORT"
    say "默认已挂载本地存储 /data/storage，S3 可在「存储与挂载」页面添加"
    exit 0
  fi
  i=$((i + 1)); sleep 2
done
die "服务 120 秒内未就绪，请查看日志: docker logs $NAME"
