# ESXi ISO Builder

一键部署的 ESXi 自定义 ISO 构建平台。Linux 原生 xorriso 重封装，5~10 秒出 ISO；PowerCLI 作为备用引擎。

## 两个页面

- **构建流水线**：上方编排「基础镜像 → 社区驱动 → 安装参数 → 执行」，下方实时输出中文构建日志、阶段耗时和成品下载。
- **存储与挂载**：本地目录与 S3 / MinIO / R2 / OSS 多盘挂载，盘内按「基础镜像 / 驱动包 / 构建产出」管理，支持拖拽上传，S3 保存前可测试连通性。

## 一键部署

```bash
# 方式一：在线（需要能访问 ghcr.io）
curl -fsSL https://raw.githubusercontent.com/kos991/esxi-add/main/install.sh | sh

# 方式二：离线镜像包
docker load -i esxi-iso-builder.tar.gz && ./install.sh

# 方式三：compose
docker compose up -d
```

浏览器访问 `http://<服务器IP>:8080`。数据保存在 `esxi-data` 数据卷，升级镜像不会丢。

## 配置

复制 `.env.example` 为 `.env` 后修改：`APP_PORT`、`API_TOKEN`（设置后接口需带 `X-API-Token`）、`APP_IMAGE`。

## 自行构建镜像

```bash
docker build -t esxi-iso-builder:local --build-arg APP_VERSION=$(cat VERSION) .
APP_IMAGE=esxi-iso-builder:local ./install.sh
```

## 分支

- `main`：当前版本（本分支）。
- `archive/*`：历史版本归档，只读保留。
