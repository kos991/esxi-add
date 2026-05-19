# ESXi ISO Builder

用于内网构建 ESXi 自定义 ISO 的单容器服务。主分支只保留 Docker 部署说明；完整源码在 `source` 分支。

## 界面截图

![总览](docs/images/overview.png)

![文件管理](docs/images/files.png)

![自定义构建](docs/images/build.png)

## Docker Compose

创建 `.env`：

```env
APP_IMAGE=ghcr.io/kos991/esxi-add:latest
APP_PORT=8080
BUILD_MODE=local
WORKER_TOKEN=change-this-worker-token
```

启动：

```bash
docker compose up -d
```

访问：

```text
http://localhost:8080
```

更新：

```bash
docker compose pull
docker compose up -d
```

查看状态：

```bash
docker compose ps
docker compose logs -f app
```

## Docker

不使用 Compose 时可以直接运行：

```bash
docker run -d \
  --name esxi-add \
  --restart unless-stopped \
  -p 8080:8080 \
  -e BUILD_MODE=local \
  -e WORKER_TOKEN=change-this-worker-token \
  -v esxi-data:/data \
  ghcr.io/kos991/esxi-add:latest
```

## 配置

常用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_IMAGE` | `ghcr.io/kos991/esxi-add:latest` | Compose 使用的镜像 |
| `APP_PORT` | `8080` | 宿主机访问端口 |
| `BUILD_MODE` | `local` | 本机容器内构建模式 |
| `WORKER_TOKEN` | 空 | Worker 接口令牌 |
| `API_TOKEN` | 空 | 可选 API 访问令牌 |
| `STORAGE_PATH` | `/data/storage` | 本地文件存储目录 |
| `CACHE_DIR` | `/data/builds` | 构建缓存目录 |

## 源码

完整后端、前端、脚本和测试代码请看：

```bash
git checkout source
```

Release 说明见 [RELEASES.md](RELEASES.md)，历史变更见 [CHANGELOG.md](CHANGELOG.md)。
