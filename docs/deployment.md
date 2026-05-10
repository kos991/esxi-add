# 部署说明

`main` 分支只保留发布说明。可构建源码在 `dev`。

## 快速启动

```bash
docker-compose pull
docker-compose up -d
```

## 环境变量

```env
APP_IMAGE=ghcr.io/kos991/esxi-add:latest
APP_PORT=8080
DB_PATH=/data/db/esxi-builder.db
CACHE_DIR=/data/builds
STORAGE_TYPE=local
STORAGE_PATH=/data/storage
BUILD_MODE=local
REDIS_URL=redis://127.0.0.1:6379
WORKER_TOKEN=change-this-worker-token
```

## 142 服务器

142 服务器使用：

```text
/opt/esxi-add/docker-compose.yml
```

手动更新：

```bash
ssh root@192.168.0.142
cd /opt/esxi-add
docker pull ghcr.io/kos991/esxi-add:latest
docker-compose up -d
```

## 截图目录

`docs/screenshots/` 保存主页面截图，方便快速核对发布版界面。
