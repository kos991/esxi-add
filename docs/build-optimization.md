# 构建优化与验证

所有修改位于现有 `source-cleanup` 工作树；此前 5 个文件的死代码清理（82 行删除）保留，未改动原始数据。以下验证描述为优化阶段的历史记录；后续真实 Docker 部署、提交与隔离服务验收见 `deployment-142-status.md`。

## 已实施

### Docker / Go / Vite

- Dockerfile 使用 BuildKit cache mount 缓存 npm 下载、Go 模块与 Go 编译结果。共享挂载均使用 `sharing=locked`，并发构建需要等待相同缓存挂载；优先保证缓存写入互斥。
- npm 仍执行 `npm ci`，明确复制 package.json 与 package-lock.json。只跳过构建安装过程的 audit/fund，不跳过依赖安装、生命周期脚本或 TypeScript 检查；安全审计可独立执行 `npm audit`。
- Go 编译使用 `-mod=readonly`，依赖清单有问题时失败，不隐式修改清单。模块缓存同时挂载到下载与编译步骤；即使缓存被清理，Go 也可在编译时重新下载，不能将缓存存在作为正确性前提。
- 后端只复制 cmd、internal 和 go.mod/go.sum。原 `COPY . .` 会让前端、文档、脚本变动影响后端编译层；现后端编译输入不再包含这些目录。扫描 cmd/internal 没有 go:embed 或 go:generate 引入额外文件。
- 排除 docs 构建上下文。该目录实测 43 个文件共 4,056,659 字节（包含原已由 `*.md` 排除的文件，因此此数不等同于新增减少的传输量）。
- Vite 保留 `tsc && vite build`，没有通过跳过类型检查、关闭压缩或随意拆包制造加速。

源码构建需要支持 Dockerfile cache mounts 的 BuildKit，例如：

```sh
docker buildx build --load -t esxi-add:local .
```

Compose 默认拉取发布镜像；`make docker-up` 不会执行上述源码编译。BuildKit 缓存属于 builder，不写入运行镜像或 `/data`，可由 Docker 正常回收；不要将不受信任的构建共享到同一 builder。Go 自身按工具链、目标和源码判定编译缓存有效性，npm 按锁文件与完整性元数据安装。未固定的基础镜像标签及 Python 包版本仍是现有可重现性限制，本轮没有未经兼容性验证替换 PowerCLI 镜像。

### 外部 worker 下载

- 仅在单次 `Invoke-BuildProcess` 内复用已经成功下载的相同 bucket/object；下次调用使用新的 GUID 输入目录和空映射。接口没有提供不可变对象版本/ETag，因此不建立跨任务共享缓存。
- 用 bucket ID 和完整 object path 的 SHA-256 建立目录，原文件名保留，避免不同路径同名文件覆盖，同时保留扩展名及 vmkusb/fling 的 bundle-first 判断。
- 下载先写唯一 `.partial` 文件，非空成功后才移动并加入复用映射。失败清理临时文件，最多 3 次尝试，间隔 1/2 秒，每次请求设置 1800 秒超时。重试对象仅为 GET 输入下载，不重试领取任务或上传结果等有副作用操作。
- 不同构建调用的下载目录隔离；这不是对同一任务重复启动多个完整构建进程的协调机制。成功输入与任务产物仍沿用原有保留策略，未自动删除用户历史任务目录。

## 检查过但未修改的产品链路

- 内置 queue：本地存储直接解析路径；S3 使用 bucket 级缓存目录；完成后通过 TeeReader 一次完成上传与 SHA-256 计算，没有额外完整读盘哈希遍历可删。
- PowerCLI：保留驱动载入顺序、profile 选择、ESXi 6.7 与特定 7.x 驱动的 bundle-first 兼容导出。不以两次导出看似重复为理由删除该兼容分支。
- 现有 Go S3 CacheManager 存在固定 `.tmp`、数据与 ETag 分开更新、可变路径被其他构建使用时可能替换、清理缺少读者租约等风险。没有对其增加并发预取或扩大共享使用。完整修复需不可变版本路径、发布与清理协调及远端版本一致性协议，不能靠给单个 manager 加 mutex 声称跨进程安全。
- worker 下载接口不返回内容摘要/固定版本；模拟网络异常与空文件检测不等于端到端内容完整性校验，真实 ISO 正确性仍需 PowerCLI 与真实输入验证。

## 验证证据

1. 从 Git HEAD 提取原 Save-WorkerFile 函数，以 mock HTTP 执行 `a/driver.zip`、重复 `a/driver.zip`、`b/driver.zip`：3 次请求，两个不同对象落到同一路径，发生覆盖。
2. 修改后相同负载：2 次请求（减少 1/3），重复对象复用，不同对象分别保留。此为请求次数实测，不是公网耗时或 ISO 总耗时对比。
3. `scripts/external-build-worker_test.ps1`：函数 AST 加载与 mock HTTP 测试，覆盖上述复用、bucket/path 隔离、模拟中断后恢复、3 次重试上限、失败不污染复用映射、partial 清理、新构建重新下载、独立调用目录隔离。未执行真实 worker 主循环或触碰服务。
4. `go test ./cmd/... ./internal/... ./scripts` 与 `go vet ./cmd/... ./internal/... ./scripts` 通过。
5. Linux amd64 / CGO_ENABLED=0 的 `go build -mod=readonly` 通过，临时二进制已删除。
6. 前端 package.json 与 lock 根依赖映射一致；复用已有 node_modules，254 个已安装包逐项版本匹配，缺失的非可选包为 0。未修改 package.json/package-lock.json/go.mod/go.sum。
7. 前端 4 个测试文件、11 个测试通过；生产 `tsc && vite build` 通过，3192 个模块。仍有既有 React act/jsdom/Vite 弃用与大 chunk 提示。临时依赖 junction 与本次 dist 已清理。

没有运行真实 Docker 镜像构建、PowerCLI ISO 导出、外部网络/存储集成或多进程压力测试。Docker 仅验证配置、输入依赖和本机编译；不能据此声称 Docker 缓存命中率、镜像构建秒数或 ISO 可启动性。宿主 Go/Node 版本也不等同于 Docker Go 1.21 / Node 20 的完整兼容矩阵。
