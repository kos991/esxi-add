# Changelog

## v0.3.0 - 2026-11-14

- 前端重构为两个页面：构建流水线（上编排、下中文日志）与存储与挂载。
- 全部图标改为原生内联 SVG，移除第三方图标库依赖。
- 新增 `POST /api/buckets/test-config`：S3 / 本地挂载保存前先测试连通性。
- 构建引擎默认切换为 Linux 原生 xorriso 重封装（5~10 秒），PowerCLI 保留为备用。
- 新增 `install.sh` 一键部署脚本与 `make save` 离线镜像包。
- 历史版本归档到 `archive/*` 分支。

# Changelog

## v0.2.0 - 2026-05-09

- Single all-in-one Docker image for backend, frontend, Redis, PowerShell, and PowerCLI.
- Local and S3-compatible storage nodes with public ISO download links.
- Mixed-storage Depot discovery in the build wizard.
- Depot and driver preflight download validation before builds start.
- Build artifact download actions for local API download and remote public URL download.
- Storage bucket API no longer returns stored secret keys.
- Removed legacy standalone frontend image files and brittle frontend source-string Actions tests.
