# ESXi ISO Builder (v1.0.0)

一键部署的 ESXi 自定义 ISO 构建平台。Linux 原生 xorriso 重封装（5~10 秒出 ISO），内置 PowerCLI 离线包合成引擎，支持官方原版定制、品牌机（Dell / H3C / 浪潮 / HPE）一键转 ISO、社区/阵列卡/网卡驱动注入及 S3 自动归档清理。

## 一键部署

### 方式一：脚本一键启动

```bash
curl -fsSL https://raw.githubusercontent.com/kos991/esxi-add/main/install.sh | sh
```

### 方式二：Docker Compose

```bash
curl -fsSLO https://raw.githubusercontent.com/kos991/esxi-add/main/docker-compose.yml
docker compose up -d
```

### 方式三：Docker 直接运行

```bash
docker run -d \
  --name esxi-iso-builder \
  --restart unless-stopped \
  -p 8080:8080 \
  -v esxi-data:/data \
  --tmpfs /tmp:size=3G,mode=1777 \
  ghcr.io/kos991/esxi-add:latest
```

启动后浏览器访问 `http://<服务器IP>:8080`。数据持久化在 `esxi-data` 数据卷中，升级容器不会丢失配置与文件。

## 功能概览

- **构建流水线**
  - **定制构建**：按「基础镜像 → 驱动注入 → 安装参数 → 确认并运行」四步完成构建，支持无人值守 / 交互式安装、Intel 大小核防紫屏、8GB 系统盘精简、老旧 CPU 放行与无头模式。
  - **品牌镜像直下**：Dell / H3C / 浪潮 / HPE 定制包直接下载、一键转 ISO 或带入向导补充驱动。
  - **S3 自动归档**：构建完成后可自动转存至 S3 对象存储（`build/*.iso`）并清理本地生成的镜像。
- **存储与挂载**
  - 支持容器本地目录与 S3 / MinIO / Cloudflare R2 / 阿里云 OSS 对象存储多盘挂载，按「基础离线包 / 扩展驱动 / 安装镜像 ISO / 构建产出」分类管理。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_IMAGE` | `ghcr.io/kos991/esxi-add:latest` | 运行镜像 |
| `APP_PORT` | `8080` | 宿主机映射端口 |
| `API_TOKEN` | 空 | 可选 API 访问令牌（设置后请求需带 `X-API-Token`） |
| `STORAGE_PATH` | `/data/storage` | 容器内本地存储路径 |
| `CACHE_DIR` | `/tmp/builds` | 构建临时缓存目录 |

## 分支说明

- `main`：仅保留部署与使用说明。
- `dev`：完整前后端源码与开发分支（`git checkout dev`）。
