# Releases

发布页用于说明可直接部署的 Docker 镜像版本。

## 镜像

默认镜像：

```text
ghcr.io/kos991/esxi-add:latest
```

推荐生产部署固定版本标签，例如：

```env
APP_IMAGE=ghcr.io/kos991/esxi-add:v0.2.0
```

## 分支约定

- `main`：只保留 Docker Compose 使用说明、Docker 运行说明、截图和发布说明。
- `source`：保留完整源码、前端、后端、脚本和测试。

## 发布说明写法

每个 Release 建议包含：

- 镜像标签
- 主要功能变化
- 升级步骤
- 兼容性或迁移说明
- 已知问题

## 升级命令

```bash
docker compose pull
docker compose up -d
```
