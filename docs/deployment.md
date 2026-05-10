# 部署说明

## 单容器部署

默认部署方式是一个 all-in-one 镜像，镜像内包含：

- Go API 服务
- 已构建的前端静态资源
- Redis
- PowerShell
- VMware PowerCLI
- ESXi ISO 构建脚本

运行数据保存在容器内 `/data`，建议通过 Docker volume 持久化。

## 环境变量

在 `docker-compose.yml` 同级目录创建 `.env`：

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

固定版本部署时，把 `APP_IMAGE` 改成版本标签：

```env
APP_IMAGE=ghcr.io/kos991/esxi-add:v0.2.0
```

## 启动

Docker Compose v1：

```bash
docker-compose pull
docker-compose up -d
```

Docker Compose v2：

```bash
docker compose pull
docker compose up -d
```

检查服务：

```bash
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/api/system/status
```

## 更新

```bash
docker-compose pull
docker-compose up -d --force-recreate
```

如果服务器使用 Compose v2：

```bash
docker compose pull
docker compose up -d --force-recreate
```

## 142 服务器部署

当前 142 服务器路径：

```text
/opt/esxi-add/docker-compose.yml
```

手动部署命令：

```bash
ssh root@192.168.0.142
cd /opt/esxi-add
docker pull ghcr.io/kos991/esxi-add:latest
docker-compose up -d
```

验证：

```bash
curl http://192.168.0.142:8080/health
curl http://192.168.0.142:8080/api/system/status
```

142 当前是 `docker-compose 1.29.2`，没有 `docker compose` 插件。GitHub Actions 的部署脚本已经兼容两种命令。

## GitHub Actions 部署配置

推送 `main` 后会执行：

1. 后端测试。
2. 前端 `npm ci`、测试和构建。
3. 构建并推送 `ghcr.io/kos991/esxi-add:latest`。
4. SSH 到 142 拉取新镜像并重启服务。

仓库 Secrets：

```text
DEPLOY_USER       SSH 用户，142 当前使用 root
DEPLOY_SSH_KEY    SSH 私钥
DEPLOY_HOST       可选，默认 192.168.0.142
DEPLOY_PORT       可选，默认 22
DEPLOY_PATH       可选，默认 /opt/esxi-add
GHCR_USERNAME     可选，私有镜像登录用户名
GHCR_TOKEN        可选，私有镜像登录 token
```

如果 Actions 在同步 compose 文件阶段失败，优先检查 `DEPLOY_USER`、`DEPLOY_SSH_KEY` 和服务器 `/opt/esxi-add` 权限。

后端测试范围固定为项目源码目录：

```bash
go test ./cmd/... ./internal/... ./scripts
```

不要在 CI 中直接使用 `go test ./...`，因为前端依赖安装后，`frontend/node_modules` 里可能包含第三方 Go 包。
