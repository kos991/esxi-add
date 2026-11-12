# ISO 全链路验证记录

2026-11-13（北京时间）：**真实最小 ISO 构建、持久化、API 下载及下载产物核验通过**。未执行虚拟机或物理机启动安装测试。

## 来源与许可

用户指定仓库：https://github.com/itiligent/ESXi-Custom-ISO

固定提交：`7101ebb639ae9277b64dce13962da3d55354808f`。已核查提交、递归文件树、README、esxi8.ps1、esxi6.7.ps1、LICENSE 和 Release API。当前树包含驱动 ZIP/VIB，无基础 ISO/Depot；Release API 返回空列表。无 .gitattributes LFS 配置；实际下载驱动为有效 ZIP，Git blob 校验一致，非 LFS 指针。

基础镜像来自该提交 esxi8.ps1 的 SharePoint 外链，文件名 `VMware-ESXi-8.0U3k-25595708-depot.zip`。HEAD 不带 Cookie 时重定向到 403；保留匿名共享会话 Cookie 的 GET 成功，无需账户登录。完整下载后与官方发布说明 SHA256 比对一致：
https://techdocs.broadcom.com/us/en/vmware-cis/vsphere/vsphere/8-0/release-notes/esxi-update-and-patch-release-notes/vsphere-esxi-80u3k-release-notes.html

仓库 LICENSE 为 Apache-2.0。这不能视为其归档的 VMware 二进制也采用 Apache 许可。输入 ZIP 与嵌套 metadata ZIP 无单独 LICENSE/EULA 文件；最终 ISO 内保留 VMware-ESX-BASE-README 与 VMware-ESX-BASE-OSL.TXT，README 明确 Broadcom 版权所有及第三方开源组件许可说明。本次仅在已授权测试实例构建验证，未对外发布，未断言获得二进制再分发许可。

## 输入与兼容性

| 输入 | 字节数 | SHA256 |
| --- | ---: | --- |
| VMware-ESXi-8.0U3k-25595708-depot.zip | 682757230 | d127e29ef535a9bd178bd0f8a73754dd247cda18b3d0cbcce629dea0b8796a99 |
| VMware-Re-Driver_1.101.01-5vmw.800.1.0.20613240.zip | 209979 | 365b5b2ee604111ea651dd123d8d7167bd1513a20ec217520d26923395cfba9d |

两个 ZIP 全部成员 CRC 检查通过。驱动 Git blob SHA1 `5fcc02581df9cd61643119223feb79ec549a2a74` 与固定提交文件树一致；内部 VIB SHA256 与 metadata 一致。驱动声明 ESXi 8.0、if-re 1.101.01-5vmw.800.1.0.20613240，依赖 vmkapi_2_10_0_0；基础 esx-base 元数据提供该依赖。

## 按部署模型执行

实例：http://192.168.0.142:8080

容器：`esxi-source-cleanup-20261112-app-1`；部署目录：`/opt/esxi-source-cleanup-20261112`。

通过 `POST /api/files/upload?bucket_id=1` multipart 上传输入，不直接修改数据库或存储索引。Local Storage ID 1：Depot ID 1、driver ID 2。通过 GET 回读大小及 SHA256 与本地一致。

通过 `POST /api/builds` 提交：

```json
{
  "bucket_id": 1,
  "esxi_version": "8.0",
  "depot_path": "depots/8.0/VMware-ESXi-8.0U3k-25595708-depot.zip",
  "driver_paths": ["drivers/8.0/network/VMware-Re-Driver_1.101.01-5vmw.800.1.0.20613240.zip"],
  "custom_iso_name": "ESXi-8.0U3k-25595708-e2e-realtek",
  "image_profile": "ESXi-8.0U3k-25595708-no-tools"
}
```

任务 ID：`fe75f12a-0ca8-4ad8-81a8-042309650195`。

开始：2026-11-12T16:11:58.93157005Z；完成：2026-11-12T16:16:32.63612731Z。最终 `completed`、100%、error_message 空、build_duration 273 秒。

持续检查 API 状态、任务日志、容器日志和进程；关键日志依次包含 `Using image profile: ESXi-8.0U3k-25595708-no-tools`、`Adding package: if-re`、`Export strategy: direct`、`Done`、`ISO created`、`ISO uploaded to output/ESXi-8.0U3k-25595708-e2e-realtek.iso`。

本地存储 worker 直接读取输入，不涉及 S3 输入下载或 S3 上传。实际覆盖：公开源下载 → 校验 → 实例上传/入库 → Redis 队列消费 → PowerCLI 加载/注入/导出 → Local Storage 持久化 → API 下载 → 独立产物验证。

## 下载产物验证

下载接口：http://192.168.0.142:8080/api/builds/fe75f12a-0ca8-4ad8-81a8-042309650195/artifact

返回 HTTP 200，Content-Type `application/x-iso9660-image`。本地保留：`data/verified-iso/ESXi-8.0U3k-25595708-e2e-realtek.iso`（相对项目根目录）。

- 大小：488624128 字节（约 466.0 MiB），与任务记录一致。
- SHA256：`147130365439cf23ac7d850ce6d3fb2373bdd16ea3832228d6d7006d04d5672e`，独立计算与服务端记录一致。
- ISO9660 解析成功，卷标 `CUSTOM-8.0-20261112-161248`。
- El Torito 引导目录存在，校验和及 55AA 标志正确，BIOS 引导条目为 bootable。
- EFI/BOOT/BOOTX64.EFI 存在，222704 字节；BIOS 和 EFI boot.cfg 均指定 build `8.0.3-0.102.25595708` 并加载 `/ifre.v00`。
- boot.cfg 的 113 个模块全部存在且非空。
- ISO 内 IFRE.V00 为 221108 字节，与源 VIB 的 ifre 载荷逐字节一致；SHA256 `9b82f310947d62d98f52879a2f72161ac539f516f432c4542f4bb2b277b83124`。

证据快照与任务日志保存在本报告旁 `iso-e2e-evidence/`。

## 发现与边界

- 磁盘 I/O 等待采样 49%–62%，上传 SQL 写入耗时 50–69 秒，Redis 报 AOF fsync 慢，API 间歇 SQLITE_BUSY。客户端上传超时后先查询确认已持久化，未盲目重复提交。数据库日志持久化显著拖慢最终状态更新。
- 任务日志出现 `read |0: file already closed`，但导出、任务完成、下载及独立文件核验全部通过；此日志读取问题未在本次改动源码修复。
- 现有导出脚本使用 `-NoSignatureCheck`、CommunitySupported。哈希、结构和驱动载荷校验不等同于 VMware 签名链验证或 Secure Boot 验证。
- 没有实施开机安装、硬件网卡工作验证或性能基准。
- 最终 /health 为 healthy，app 与原有 veladns 容器仍 healthy；Redis default active/pending 均为 0。未重启或替换服务，未修改产品源码、认证或持久化配置。
- 临时来源 ZIP、匿名 Cookie 与临时 pycdlib 依赖清理；实例保留真实输入、任务与正式产物，本地保留核验后的 ISO 和证据报告。
