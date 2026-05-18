# ESXi ISO Builder

当前版本：`v0.2.0`

ESXi ISO Builder 是一个用于 ESXi ISO 自动化构建的单容器平台。项目包含 Go 后端、React/Umi Max 前端、Redis、PowerShell、VMware PowerCLI 和构建脚本，适合部署成一套内网构建服务。

## 主要能力

- 管理 ESXi Depot、驱动包、ISO 输出文件和存储节点。
- 支持本地存储，也支持 S3 兼容存储或 Cloudflare R2。
- 构建前会下载并校验 Depot、ZIP、VIB，避免无效文件进入 PowerCLI。
- 页面包含总览、本机运行状态、存储挂载、文件库、自定义构建、任务与实时日志。
- 构建任务支持进度、日志、历史记录和 ISO 下载。

## 快速启动

```bash
docker-compose pull
docker-compose up -d
```

访问：

```text
http://localhost:8080
```

固定版本镜像可以在 `.env` 中设置：

```env
APP_IMAGE=ghcr.io/kos991/esxi-add:v0.2.0
APP_PORT=8080
```

## 本地开发

后端：

```bash
go test ./cmd/... ./internal/... ./scripts
go run ./cmd/server
```

前端：

```bash
cd frontend
npm install
npm run dev
```

前端构建和测试：

```bash
cd frontend
npm run test
npm run build
```

CI 使用 Node.js 20 和 npm 10。更新 `frontend/package-lock.json` 时建议使用同版本 npm，避免 GitHub Actions 的 `npm ci` 因锁文件不同步失败。

## 项目结构

```text
cmd/server/              后端入口
internal/config/         配置读取
internal/database/       数据库初始化和迁移
internal/models/         数据模型
internal/storage/        本地存储和 S3/R2 适配
internal/services/       文件服务
internal/queue/          构建任务队列
internal/builder/        PowerShell 构建执行器
internal/websocket/      实时日志和任务推送
frontend/                Umi Max / Ant Design Pro 前端
scripts/                 ESXi ISO 构建脚本
configs/                 默认配置
docker/                  单容器启动脚本
docs/                    使用和部署文档
```

## 文档

- [使用说明](docs/usage.md)
- [部署说明](docs/deployment.md)
- [更新记录](CHANGELOG.md)

## 仓库整理规则

以下内容只保留在本机，不提交到仓库：

- `frontend/node_modules/`
- `frontend/dist/`
- `.chrome-debug/`
- `.claude/`
- `docs/pencil-import/`
- `*.iso`
- 数据库和运行数据目录
