# 构建期间 SQLite、上传和日志修复

工作树：`source-cleanup`。依据 `LOCAL_PROJECT_HANDOFF.md`、`docs/iso-e2e-verification.md` 和 `docs/iso-e2e-evidence/task.log`。修改前 Git 状态仅有已有的 ISO 验证文档和证据未跟踪，没有覆盖它们。未找到 AGENTS.md。

## 根因与修改

- 驱动为 glebarez/sqlite 1.11.0 → glebarez/go-sqlite 1.21.2；其源码 `applyQueryParams` 默认设置 busy_timeout=5000，支持每连接 `_pragma` 和 `_txlock`。原 InitDB 未限制连接数，也未启用 WAL。现每进程限制 1 个连接，DSN 对替换连接也设置 busy_timeout=10000，显式事务采用 immediate，文件数据库启用并检查 WAL；内存数据库允许返回 memory。保留同步持久化默认级别，不以降低可靠性换性能。迁移事务中使用 tx，外部存储 I/O 不放入数据库事务。
- 构建原来每行日志和进度各执行一次 UPDATE，现每 64 行或 250ms 合并一次；结束刷新尾批，错误返回调用者。实时广播保留，脚本 100% 在产物保存前限制为 99%。
- 原日志有 `read |0: file already closed`；执行器先 Wait 后等待 scanner，违反 StdoutPipe/StderrPipe 生命周期。现先并发读完两条管道再 Wait。扫描失败仍报错并排空剩余数据，防止超长行导致子进程堵塞。
- 上传落盘后的元数据操作用独立、最长 30 秒的上下文完成。失败返回 HTTP 409、code=`upload_stored_metadata_pending`，附桶/路径/大小/哈希和 stored=true、metadata_confirmed=false，明确不能当成未上传。响应丢失仍只能表示结果未知；页面禁止自动重试，回查资产列表并提示先刷新元数据确认。已有桶＋路径唯一键 upsert 保留；未引入任务平台或新的上传数据库。刷新可重新索引已存储对象，不需重传；它不会恢复上传时计算的 SHA256，因此不能把相同文件名和大小当作内容相同证明。
- 成功任务新增毫秒计时：input_prepare（本地路径解析或 S3 缓存、输入校验）、powercli_process（进程及输出读取，含消费背压）、artifact_persist（实际存储写入与 SHA256，不含最后任务 SQL 提交）；脚本另有 powercli_load、depot_profile、driver_injection、iso_export。InspectProfiles 输出不添加计时以保留 JSON 协议。

## 验证

- `go test ./cmd/... ./internal/... ./scripts` 最终通过，含实际 PowerShell 双管道慢消费者、每连接 PRAGMA 重建检查和日志/状态/上传并发测试。
- 并发测试使用磁盘 SQLite、两个独立连接池模拟 API/worker；500 行日志完整保留，实际只有 8 次 SQL UPDATE；100 次状态读取和 20 次本地上传均成功。
- 上传请求取消仍完成元数据写入、注入数据库失败后不重传恢复均通过。HTTP 测试确认部分完成返回 409、专用 code、stored=true、metadata_confirmed=false 及文件路径/SHA256。
- 临时恢复旧 Wait 顺序执行 `go test -count=1 -v ./internal/builder -run TestExecuteBuildDrainsPipes`：稳定复现 stdout/stderr 两条 file already closed。恢复修复后同一测试通过，两个流各 200 行完整保留；扫描超长行报告错误并排空也通过。
- `npm ci --no-audit --no-fund` 后执行 `npm test`（11/11）及 `npm run build`（含 tsc）均通过。有 React act/jsdom、Vite 弃用及 bundle 大小警告，无失败。
- PowerShell AST 解析和 `git diff --check` 通过。验证生成的 node_modules、dist 已清理。

## 边界

没有部署、重启或修改 142 实例；未重新运行真实 PowerCLI ISO 导出。单连接会在进程内排队，WAL 不能解决慢磁盘或跨进程持续占锁超过等待时限。文件已保存后的进程崩溃仍可能需要刷新元数据恢复；没有宣称 HTTP 丢失响应时做到 exactly-once。阶段计时目前在成功阶段输出，失败阶段尚无完整持续时间记录。
