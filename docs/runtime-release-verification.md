# 运行时修复复核与隔离发布实测报告

状态：已完成，新镜像 `e1e0b59e4ecd` 在 192.168.0.142 部署成功，真实构建与产物核验全部通过，旧服务无影响。

- 目标实例：http://192.168.0.142:8080，Compose 项目 `esxi-source-cleanup-20261112`
- 当前运行镜像：`sha256:e1e0b59e4ecdbb89c968bbd400f68e7b91247a5d2295f01a6867d6181dddda69`（标签：`esxi-source-cleanup:runtime-20261113`）
- 历史稳定镜像回滚锚点：`sha256:e1ef98a5b17a8ab5190b9e1c77c049d5ff987de8456cb4dd14fec0dcdd061a8d`（标签：`esxi-source-cleanup:stable-c9fe5bf`，独立回滚脚本：`/opt/esxi-source-cleanup-20261112/releases/runtime-20261113/rollback.sh`）

---

## 1. 真实端到端构建验证（与基准对照）

### 1.1 作业提交与输入

- 任务 ID：`dc28a628-3798-4e5d-a4fe-530b1bbc9266`
- 提交时间：2026-11-12T17:09:53.159553234Z
- 开始执行：2026-11-12T17:09:53.621022638Z
- 完成时间：2026-11-12T17:12:47.772591551Z
- 终态状态：`completed`，进度 100%，`error_message`: `""`
- 输入参数（与基准作业完全一致）：
  - `bucket_id`: 1
  - `esxi_version`: `8.0`
  - `depot_path`: `depots/8.0/VMware-ESXi-8.0U3k-25595708-depot.zip`
  - `driver_paths`: `["drivers/8.0/network/VMware-Re-Driver_1.101.01-5vmw.800.1.0.20613240.zip"]`
  - `custom_iso_name`: `ESXi-8.0U3k-25595708-e2e-realtek`
  - `image_profile`: `ESXi-8.0U3k-25595708-no-tools`

### 1.2 异常与并发错误排查

- **SQLITE_BUSY 错误**：**0 次**。
  - 根因分析：此前每次日志行和进度更新均单条执行同步事务，导致高 I/O 延迟下频繁发生 SQLite 忙锁。本轮合并批次更新（每 64 行或 250ms 合并）并启用单连接 WAL 与 busy_timeout=10000 之后，全生命周期与轮询查询均顺畅无锁冲突。
- **file already closed 错误**：**0 次**。
  - 根因分析：此前执行器在 Wait 之后才等待 scanner 退出，违反了管道生命周期，导致 `read |0: file already closed`。本轮调整为先并发读完管道再调用 Wait，该问题已彻底根除。

### 1.3 结构化阶段耗时对比

从任务执行日志中提取到的结构化 `[TIMING]` 指标如下：

| 阶段 | 阶段标识 | 本轮耗时 (ms / 秒) | 占比说明 |
| --- | --- | ---: | --- |
| 1. 输入准备 | `input_prepare_ms` | 0 ms (0.00s) | 本地存储路径命中与校验 |
| 2. PowerCLI 运行时初始化 | `powercli_load_ms` | 7,210 ms (7.21s) | VMware.ImageBuilder 模块加载 |
| 3. 加载 Depot 与克隆 Profile | `depot_profile_ms` | 3,647 ms (3.65s) | 读取 depot 元数据并克隆 no-tools 基础 profile |
| 4. Realtek 驱动注入 | `driver_injection_ms` | 1,342 ms (1.34s) | 注入 if-re 驱动包 |
| 5. ISO 镜像导出 | `iso_export_ms` | 152,846 ms (152.85s) | ifServerStarter.py 生成 ISO9660 文件系统 |
| 6. 子进程总耗时 | `powercli_process_ms` | 166,019 ms (166.02s) | 包含执行器双管道读取与背压处理 |
| 7. 产物持久化与哈希计算 | `artifact_persist_ms` | 7,246 ms (7.25s) | 流式 SHA256 与原子重命名入库 |
| **任务总耗时（数据库记录）** | `build_duration` | **174 秒** | **较此前 273 秒基准减少 99 秒（加速 ~36.3%）** |

对比分析：
- 导出 ISO 核心开销主要受底层磁盘 I/O 等待影响（152.8 秒为 VMware ImageBuilder 必要工作）；
- 总耗时从 273 秒显著下降至 174 秒（缩短 99 秒），主要得益于：
  1. 日志与状态持久化批量合并，避免了数十次由于磁盘 I/O 引起的单行写事务挂起；
  2. 管道关闭生命周期修复，避免进程退出阶段的阻塞挂起；
  3. 本地存储持久化流式原子写入。

---

## 2. ISO 产物核验

通过 API 下载并对新生成的 ISO 进行端到端完整校验：
- 下载接口：`GET /api/builds/dc28a628-3798-4e5d-a4fe-530b1bbc9266/artifact`
- HTTP 响应：`200 OK`，`Content-Type: application/x-iso9660-image`，`Content-Length: 488624128`
- 产物大小：`488,624,128` 字节（466.0 MiB），与数据库元数据一致
- 产物 SHA-256：`144761b9092451b2af91eae6904e3af7c2b97f46b43afa3a954519f9cca32e59`
- ISO9660 卷标：`CUSTOM-8.0-20261112-171003`，逻辑扇区大小 2048 字节，扇区数 238586
- El Torito 引导目录（扇区 1525）：
  - Validation Entry 头部 ID 0x01，平台 0x00（x86），签名 0x55AA 正确，校验和为 0（有效）
  - Initial/BIOS 引导条目（扇区 114577）：Boot Indicator 0x88（Bootable），无仿真
  - Section Header（平台 0xEF = EFI）及 EFI 引导条目（扇区 16079）：Boot Indicator 0x88（Bootable）
- 引导配置文件与驱动验证：
  - `BOOT.CFG` 与 `EFI/BOOT/BOOT.CFG` 均包含 `build=8.0.3-0.102.25595708` 并在 modules 列表加载 `/ifre.v00`
  - `EFI/BOOT/BOOTX64.EFI` 存在且非空（222,704 字节）
  - ISO 内驱动载荷文件 `IFRE.V00`（扇区 96186，大小 221,108 字节）独立 SHA256 为 `9b82f310947d62d98f52879a2f72161ac539f516f432c4542f4bb2b277b83124`，与官方/源 VIB 驱动载荷逐字节完全一致

---

## 3. 容器与服务状态检查

1. 新实例：
   - 容器：`esxi-source-cleanup-20261112-app-1`
   - 镜像：`sha256:e1e0b59e4ecdbb89c968bbd400f68e7b91247a5d2295f01a6867d6181dddda69`
   - 状态：`running (healthy)`，重启计数 0
   - `/health` 返回 200，`database: connected`, `status: healthy`
   - `/api/system/status` 返回 200，8 核 CPU 负载 0%，可用内存 7098 MiB
2. 现有旧服务：
   - 容器：`veladns`（ID `3bf2b83337350b24db9988ce86750a201cce60fe493c094506b69f8fabc54205`）
   - 状态：`running (healthy)`，重启计数 0，`StartedAt: 2026-11-12T12:39:42.167110775Z`（完全未变）
   - 容器：`veladns-before-real-20261112`（ID `31fdd37989137455a181edf4109aaacec007b678e03e76c708f569307df5cd0b`）
   - 状态：`exited (0)`，维持原有停止状态，未被修改或清理
