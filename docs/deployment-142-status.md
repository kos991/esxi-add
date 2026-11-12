# 192.168.0.142 隔离部署执行记录

状态：部署成功，2026-11-12 23:49:50 +08:00 完成 HTTP 与容器健康验证。

访问地址：http://192.168.0.142:8080/

## 部署身份与隔离

- 源码：本地 `source-cleanup` 当前工作树，包含未提交修改；保留既有清理与构建优化，未改动产品源码。
- 上传归档 SHA-256：`05b6e0e79afdb9f29b0798272598f1d1c2167c68920fb4a53a24038f8ba1b474`。排除 .git、node_modules、dist、.env*、data、docs、数据库文件；部署文档在构建后更新，不属于该归档。
- 独立目录：`/opt/esxi-source-cleanup-20261112`，源码位于其 `source` 子目录。
- Compose 项目：`esxi-source-cleanup-20261112`；配置：`compose.yaml`。
- 镜像：`esxi-source-cleanup:20261112`，约 2.2 GB。
- 镜像 ID：`sha256:e1ef98a5b17a8ab5190b9e1c77c049d5ff987de8456cb4dd14fec0dcdd061a8d`。
- 容器：`esxi-source-cleanup-20261112-app-1`；ID：`dd8c65855914dc06149a4453c7e8f86b402a718d6a892b4568bb4bc9eee9487d`。
- 独立数据卷：`esxi-source-cleanup-20261112_esxi-data`，挂载 `/data`；独立网络：`esxi-source-cleanup-20261112_default`。
- 宿主机 8080 映射容器 8080；启动前已核查端口空闲。应用未采用 host 网络。
- 运行配置在构建上下文外生成，权限 0600，凭据未写入报告。

## 主机与旧服务

SSH BatchMode 密钥验证成功。主机 x86_64，Docker 26.1.5、buildx 0.13.1。原先无 Compose，本次新增 Compose v2.29.7 插件，未重启 Docker。

部署前内存约 7.8 GiB，可用约 7 GiB，根分区可用 86 GiB。原有监听包括 22、53、5353、5304、5308、5201、9527、9530、17231。

旧运行容器 `veladns`（3bf2b8333735）部署后仍 healthy；启动时间保持 `2026-11-12T12:39:42.167110775Z`。停止容器 `veladns-before-real-20261112`（31fdd3798913）仍保留且维持停止状态。两者完整容器 ID、状态、启动时间的前后记录 diff 一致（OLD_SERVICES_UNCHANGED）。未覆盖旧目录、卷、数据或服务配置，未执行全局清理。

## 真实构建与解决的问题

首次执行真实 `docker buildx build --load --progress=plain -t esxi-source-cleanup:20261112 ./source`。基础镜像准备约 18 分钟，磁盘 I/O 等待采样达 59%–62%，未发现新增内核磁盘错误。

Go 下载长时间停滞后，仅中止本次构建并使用以下命令重试，保留 Dockerfile、依赖锁文件和缓存：

```sh
cd /opt/esxi-source-cleanup-20261112
docker buildx build --network=host --load --progress=plain -t esxi-source-cleanup:20261112 ./source
docker compose -p esxi-source-cleanup-20261112 up -d --pull never
```

重试后 Go 下载完成。npm 缓存安装由约 12 分钟降至 13 秒；此对比包含网络模式差异，不是严格性能基准。构建网络参数不影响应用的独立 Compose 网络。

构建全部成功，包括 TypeScript/Vite（3192 模块）、Linux amd64 `go build -mod=readonly`、运行时依赖安装和镜像导出。Vite 存在大 chunk 提示。首次 SQLite 初始化也受到磁盘延迟影响，完成后 HTTP 正常。

## 验证结果

- 前端：4 个测试文件、11 个用例全部通过。
- 后端：`go test ./cmd/... ./internal/... ./scripts` 全部通过。
- 临时验证镜像首次缺少 Dockerfile/Compose/忽略文件，第二次缺少入口脚本；补齐验证上下文后通过。这些是验证环境缺项，没有改动产品源码。
- 用户当前电脑访问 `/`、`/health`、`/api/system/status` 均为 HTTP 200；服务器本机检查结果相同。
- Docker 状态：running / healthy，重启次数 0。
- Redis：PONG。
- PowerShell：7.2.11；可发现 VMware.ImageBuilder 8.0.0.21610262。
- 旧容器前后状态完全一致，运行中的 DNS 容器保持 healthy。

尚未使用真实 Depot/驱动输入执行 ISO 端到端构建，模块存在和 HTTP 健康不等同于 ISO 产物验证。远端存储延迟明显，可能影响后续构建速度。

## 可追溯交付复核

- 初始基线 `903e993`；已审核并本地提交此前死代码清理、Docker 缓存优化、worker 下载优化及测试，源码提交 `c9fe5bf5c5200c1d0704606d5edd663ec9296e2c`。未推送。
- 本地 Git 跟踪的 cmd/internal/scripts/docker/configs/frontend 以及 Dockerfile、go.mod/go.sum、Compose、.dockerignore，逐文件 SHA-256 与远端 source 比较全部通过。此证据结合既有构建日志关联源码与镜像；不是镜像可重现构建证明。
- 重新执行 `scripts/external-build-worker_test.ps1` 通过，实际 mock 负载 3 次引用只下载 2 次；`git diff --check` 通过。Go/前端完整测试沿用已核查的远端 `tests-final.log`，本轮未重新执行。
- 当前标签和运行容器 Image 均为 `sha256:e1ef98a5b17a8ab5190b9e1c77c049d5ff987de8456cb4dd14fec0dcdd061a8d`。
- `/health` HTTP 200，database connected / healthy。根分区可用 81 GiB；内存 available 6785 MiB。Redis default pending/active 长度均为 0；`GET /api/builds` total=0。
- `GET /api/buckets` 仅一个 Local Storage（ID 1），无已配置 S3 bucket；`GET /api/files/depots?bucket_id=1`、drivers、isos 全部返回 success=true、data=[]。容器 `/data` 与隔离部署目录检查未发现 ZIP/ISO。
- **真实 ISO 端到端阻塞在提交前的输入准备阶段**：缺少合法可用 ESXi offline Depot ZIP。没有创建虚假输入作业，无 job ID。输入下载、worker 消费、PowerCLI 导出、上传/持久化、产物下载及 ISO 签名/大小均未验证，不能判定端到端成功。项目本地存储模式不需要 S3 凭据，不能将缺 S3 凭据当成当前阻塞。后续需要导入真实 Depot ZIP，再通过 `/api/builds` 提交最小无额外驱动作业；本地存储直接读取输入，下载阶段应据此标注不适用，不能冒称完成远端下载。
- 本轮旧 veladns 完整 ID：`3bf2b83337350b24db9988ce86750a201cce60fe493c094506b69f8fabc54205`，StartedAt `2026-11-12T12:39:42.167110775Z`，与前次记录一致。未操作旧服务。
- 当前 API 可无 token 访问（本轮 GET 已验证），隔离网段之外不宜直接发布；本轮未更改现有认证配置。

## 稳定标签与回滚

已创建并验证 `esxi-source-cleanup:stable-c9fe5bf`，其镜像 ID 与运行容器的 Image 完全一致：`sha256:e1ef98a5b17a8ab5190b9e1c77c049d5ff987de8456cb4dd14fec0dcdd061a8d`。容器 Config.Image 仍为原部署标签 `esxi-source-cleanup:20261112`；没有为修改显示名称重建健康容器，身份通过不可变 Image ID 确定。

远端已写入 `compose.stable-c9fe5bf.yaml`（仅覆盖 app.image），执行合并配置 `config --images` 返回稳定标签。此标签是本次健康服务的回滚锚点，不是虚构的历史 app 版本。恢复命令如下，适用于本次 Compose 与数据结构未发生不兼容修改的情况：

```sh
cd /opt/esxi-source-cleanup-20261112
# 校验成功后才继续；标签缺失或指向改变时中止。
test "$(docker image inspect esxi-source-cleanup:stable-c9fe5bf --format '{{.Id}}')" = 'sha256:e1ef98a5b17a8ab5190b9e1c77c049d5ff987de8456cb4dd14fec0dcdd061a8d' || exit 1
docker compose -p esxi-source-cleanup-20261112 -f compose.yaml -f compose.stable-c9fe5bf.yaml up -d --no-deps --pull never app
curl --fail http://127.0.0.1:8080/health
```

配置合并、标签和 Image ID 已实测；未人为破坏服务再演练恢复，不宣称完整回滚演练成功。命令保留现有数据卷且只管理 app；镜像回滚不会恢复数据库。保留上述镜像、Compose 和数据卷，不执行全局 prune 或 down -v。

最终再次验证 app 为 healthy；旧 veladns ID 与 StartedAt 与本轮起始记录逐值一致。没有提交 ISO 作业，真实构建验证仍为明确阻塞，服务保留。

## 证据与维护

独立部署目录内保留 `build.log`、`build-retry.log`、`tests.log`、`tests-retry.log`、`tests-final.log`、`source.sha256`、`old-services-before.txt`、`old-services-after.txt`、`deployment-evidence.txt`。失败尝试日志用于追溯；最终成功以 `build-retry.log`、`tests-final.log` 为准。

仅管理本次实例：

```sh
cd /opt/esxi-source-cleanup-20261112
docker compose -p esxi-source-cleanup-20261112 ps
# 停止本次实例但保留数据：
docker compose -p esxi-source-cleanup-20261112 stop
# 恢复本次实例：
docker compose -p esxi-source-cleanup-20261112 up -d --pull never
```

不要添加 `down -v`，不要清理旧服务或其数据。构建缓存保留供后续复用。

## 2026-11-13 运行时修复与全链路验证结果 (runtime-20261113)

- 镜像标签：esxi-source-cleanup:runtime-20261113
- 镜像 ID：sha256:e1e0b59e4ecdbb89c968bbd400f68e7b91247a5d2295f01a6867d6181dddda69
- 容器：esxi-source-cleanup-20261112-app-1（重启次数 0，持续 healthy）
- 回滚锚点：/opt/esxi-source-cleanup-20261112/releases/runtime-20261113/rollback.sh（回滚至 esxi-source-cleanup:stable-c9fe5bf / sha256:e1ef98a5b17a...）
- 真实构建验证：
  - 作业 ID：dc28a628-3798-4e5d-a4fe-530b1bbc9266（ESXi 8.0U3k + Realtek 驱动，no-tools）
  - 终态：completed，100%，无报错，总耗时 174 秒（较基准 273 秒缩短 99 秒，提升 36.3%）
  - 阶段结构化耗时：输入准备 0ms，PowerCLI初始化 7,210ms，Depot加载 3,647ms，驱动注入 1,342ms，ISO导出 152,846ms，进程总耗时 166,019ms，持久化 7,246ms
  - 锁与管道问题核验：SQLITE_BUSY 0 次；ile already closed 0 次
- 产物核验：
  - 产物文件大小 488,624,128 字节，SHA256 144761b9092451b2af91eae6904e3af7c2b97f46b43afa3a954519f9cca32e59
  - ISO9660 / El Torito BIOS & EFI 双引导目录及签名校验通过
  - Injected 驱动载荷 IFRE.V00 SHA256 为 9b82f310947d62d98f52879a2f72161ac539f516f432c4542f4bb2b277b83124，与源驱动逐字节匹配
- 旧容器状态：eladns（3bf2b8333735）持续 healthy，StartedAt 维持 2026-11-12T12:39:42Z，未受任何影响
