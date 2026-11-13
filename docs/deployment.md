# 部署说明

## 一键部署

```bash
# 有网络：直接拉取运行
curl -fsSL https://raw.githubusercontent.com/kos991/esxi-add/main/install.sh | sh

# 离线：先在能联网的机器打包，再拷到目标机
make save                       # 生成 esxi-iso-builder.tar.gz
docker load -i esxi-iso-builder.tar.gz
APP_IMAGE=esxi-iso-builder:local ./install.sh
```

可用环境变量：`APP_PORT`（默认 8080）、`APP_IMAGE`、`APP_NAME`、`APP_VOLUME`、`API_TOKEN`。

## 数据与升级

所有数据（数据库、本地存储、Redis）都在数据卷 `esxi-data`。升级时重新运行 `install.sh` 即可，容器会被重建，数据保留。

## 健康检查

```bash
curl http://<服务器IP>:8080/health
```

## 构建机无法访问 Docker Hub

构建镜像需要拉取 `vmware/powerclicore` 与 `node`、`golang` 基础镜像。内网构建机请给 Docker daemon 配置代理（`systemctl edit docker`，设置 `HTTP_PROXY` / `HTTPS_PROXY`），或在联网机器构建后用 `make save` 导出镜像包。