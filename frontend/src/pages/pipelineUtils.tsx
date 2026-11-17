import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { Tag } from 'antd'
import type { ReactNode } from 'react'
import type { BuildTask, FileMetadata, StorageBucket } from '../types'
import { formatBytes } from '../utils'

export const esxiVersions = ['6.5', '6.7', '7.0', '8.0', '9.0']

export function buildStatusText(status: BuildTask['status']) {
  const labels: Record<BuildTask['status'], string> = {
    pending: '等待中',
    running: '流水线运行中',
    completed: '构建成功',
    failed: '构建失败',
  }
  return labels[status] || status
}

export function BuildStatusTag({ status }: { status: BuildTask['status'] }) {
  const color: Record<BuildTask['status'], string> = {
    pending: 'default',
    running: 'processing',
    completed: 'success',
    failed: 'error',
  }
  const icon: Record<BuildTask['status'], ReactNode> = {
    pending: <ClockCircleOutlined />,
    running: <SyncOutlined spin />,
    completed: <CheckCircleOutlined />,
    failed: <CloseCircleOutlined />,
  }

  return (
    <Tag color={color[status] || 'default'} icon={icon[status]}>
      {buildStatusText(status)}
    </Tag>
  )
}

export function bucketType(bucket?: StorageBucket): 'local' | 's3' {
  return bucket?.type === 'local' ? 'local' : 's3'
}

export function bucketLocation(bucket?: StorageBucket) {
  if (!bucket) return '-'
  return bucketType(bucket) === 'local' ? bucket.local_path || '/data/storage' : bucket.endpoint || '-'
}

export function fileName(file?: FileMetadata) {
  if (!file) return '-'
  return file.path.split('/').pop() || file.path
}

export function assetTitle(file?: FileMetadata) {
  if (!file) return '-'
  const baseName = file.driver_name || fileName(file)
  return file.driver_description ? `${baseName}（${file.driver_description}）` : baseName
}

/** 普通 ISO 与构建产出必须分开，产出路径固定以 output/ 开头。 */
export function isBuildOutput(file?: FileMetadata) {
  return Boolean(file?.path && file.path.toLowerCase().startsWith('output/'))
}

export function assetTypeText(file: FileMetadata) {
  if (isBuildOutput(file)) return '构建产出 ISO'
  if (file.type === 'depot') return '基础源 (Depot/ISO)'
  if (file.type === 'driver') return '驱动包 (VIB/ZIP)'
  if (file.type === 'iso') return '普通 ISO'
  return '未识别'
}

export function cacheStatusText(file: FileMetadata, bucket?: StorageBucket) {
  if (bucketType(bucket) === 'local') return '本地直通'
  if (file.cache_status === 'cached' || file.cached) return '已缓存就绪'
  if (file.cache_status === 'stale') return '缓存需更新'
  if (file.cache_status === 'invalid' || file.cache_valid === false) return '缓存失效'
  return '未预热缓存'
}

export function cacheStatusColor(file: FileMetadata, bucket?: StorageBucket) {
  const status = cacheStatusText(file, bucket)
  if (status === '已缓存就绪' || status === '本地直通') return 'success'
  if (status === '缓存需更新') return 'warning'
  if (status === '缓存失效') return 'error'
  return 'default'
}


export type SourceKind = 'official' | 'official-patch' | 'oem'

export function fileCategoryMeta(file: FileMetadata): { label: string; color: string; kind: string } {
  const cat = (file.driver_category || '').toLowerCase()
  const path = (file.path || '').toLowerCase()
  const name = (file.driver_name || file.path || '').toLowerCase()

  if (isBuildOutput(file)) return { label: '构建产物', color: 'green', kind: 'output' }

  if (file.type === 'driver') {
    if (cat === 'community' || path.includes('/community/') || /vmkusb|net-community|nvme-community|re-driver|r8125|r8168/.test(name)) {
      return { label: '社区驱动', color: 'magenta', kind: 'community' }
    }
    if (cat === 'oem-addon' || path.includes('/oem-addon/') || name.includes('addon')) {
      return { label: '品牌 Addon', color: 'volcano', kind: 'oem-addon' }
    }
    if (cat === 'raid' || path.includes('/raid/') || /smartpqi|lsi-mr3|lsi_mr3|lsi-msgpt|lsi-uklst|nhpsa|lsu-/.test(name)) {
      return { label: '阵列卡', color: 'gold', kind: 'raid' }
    }
    if (cat === 'network' || path.includes('/network/') || /bnxtnet|i40en|icen|igbn|ixgben|nmlx|qfle|elxnet/.test(name)) {
      return { label: '网卡', color: 'blue', kind: 'network' }
    }
    if (cat === 'storage' || path.includes('/storage/') || /ahci|nvme|pvscsi|lpfc|elxiscsi/.test(name)) {
      return { label: '存储/HBA', color: 'cyan', kind: 'storage' }
    }
    return { label: '驱动', color: 'default', kind: 'other' }
  }

  // ISO / Depot：区分官方原版、官方升级补丁包、Dell/H3C/浪潮/HPE 品牌定制
  if (cat === 'oem-dell' || path.includes('/oem-dell/') || name.includes('dell')) {
    return { label: file.type === 'depot' ? 'Dell 离线包' : 'Dell 定制', color: 'cyan', kind: 'oem' }
  }
  if (cat === 'oem-h3c' || path.includes('/oem-h3c/') || name.startsWith('h3c-')) {
    return { label: file.type === 'depot' ? 'H3C 离线包' : 'H3C 定制', color: 'purple', kind: 'oem' }
  }
  if (cat === 'oem-inspur' || path.includes('/oem-inspur/') || name.includes('inspur')) {
    return { label: file.type === 'depot' ? '浪潮离线包' : '浪潮定制', color: 'orange', kind: 'oem' }
  }
  if (cat === 'oem-hpe' || path.includes('/oem-hpe/') || name.includes('-hpe-')) {
    return { label: file.type === 'depot' ? 'HPE 离线包' : 'HPE 定制', color: 'green', kind: 'oem' }
  }
  if (file.type === 'depot' || cat === 'official-patch' || path.includes('/official-patch/')) {
    return { label: '官方升级包', color: 'geekblue', kind: 'official-patch' }
  }
  return { label: '官方原版', color: 'blue', kind: 'official' }
}

export function compactSize(value?: number) {
  return value ? formatBytes(value) : '-'
}

export type ChineseLogKind = 'timing' | 'progress' | 'step' | 'success' | 'warn' | 'error' | 'normal'

export interface FormattedChineseLog {
  raw: string
  chinese: string
  kind: ChineseLogKind
  badge: string
  /** 用于耗时指标去重：同一阶段只保留一条 */
  dedupeKey?: string
}

const TIMING_LABELS: Array<{ keys: string[]; label: string }> = [
  { keys: ['input_prepare_ms'], label: '输入准备' },
  { keys: ['iso_extract_ms'], label: '基础镜像解包' },
  { keys: ['powercli_load_ms'], label: 'PowerCLI 初始化' },
  { keys: ['depot_profile_ms'], label: 'Depot 与 Profile 加载' },
  { keys: ['driver_injection_ms', 'driver_inject_ms'], label: '驱动与参数注入' },
  { keys: ['iso_export_ms', 'iso_rebuild_ms'], label: 'ISO 镜像封装' },
  { keys: ['artifact_persist_ms'], label: '产物校验入库' },
  { keys: ['powercli_process_ms'], label: '构建执行合计' },
]

function timingLabel(key: string) {
  const hit = TIMING_LABELS.find((item) => item.keys.includes(key))
  return hit ? { label: hit.label, dedupeKey: hit.keys[0] } : { label: `未登记阶段 ${key}`, dedupeKey: key }
}

/**
 * 把构建输出翻成中文语义行。
 * 判断顺序很重要：错误/警告优先，避免含 xorriso 的错误行被当成正常步骤。
 */
export function formatLogToChinese(line: string): FormattedChineseLog | null {
  // 去掉工具输出的 ANSI 颜色/控制码
  const trimmed = line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '').trim()
  const lower = trimmed.toLowerCase()

  // PowerCLI 的 CEIP 倡议与配置提示：对构建无意义，需在警告判断之前过滤
  if (
    /customer experience improvement program/i.test(trimmed) ||
    /about_ceip/i.test(trimmed) ||
    /^set-powercliconfiguration/i.test(trimmed) ||
    /^vmware's customer experience/i.test(trimmed) ||
    /^please consider joining/i.test(trimmed) ||
    /^to disable this warning/i.test(trimmed) ||
    /^for more (information|details)/i.test(trimmed) ||
    /^you can (join|opt out)/i.test(trimmed) ||
    /improve (our|its) products and services/i.test(trimmed)
  ) {
    return null
  }

  const isError = /(^|\s)(error|failed|failure|fatal|panic)(\s|:|\]|$)/i.test(trimmed)
  const isWarn = !isError && /(^|\s)warn(ing)?(\s|:|\]|$)/i.test(trimmed)

  if (isError) {
    return { raw: line, chinese: `${trimmed}`, kind: 'error', badge: '错误' }
  }
  if (isWarn) {
    return { raw: line, chinese: `${trimmed}`, kind: 'warn', badge: '警告' }
  }

  // [TIMING] 阶段耗时
  const timing = trimmed.match(/^\[TIMING\]\s+([a-zA-Z0-9_]+)=(\d+)/)
  if (timing) {
    const { label, dedupeKey } = timingLabel(timing[1])
    const ms = Number(timing[2])
    return {
      raw: line,
      chinese: `${label}：${(ms / 1000).toFixed(2)} 秒`,
      kind: 'timing',
      badge: '耗时',
      dedupeKey: `timing:${dedupeKey}`,
    }
  }

  // [PROGRESS]
  const progress = trimmed.match(/^\[PROGRESS\]\s+(\d+)\s*(.*)/)
  if (progress) {
    const rest = progress[2]?.trim() || ''
    return {
      raw: line,
      chinese: `${progress[1]}%${rest ?` · ${translateProgressText(rest)}` : ''}`,
      kind: 'progress',
      badge: '进度',
    }
  }

  const scriptRules: Array<[RegExp, string, ChineseLogKind, string]> = [
    [/native engine only accepts an existing iso/i, '原生引擎只接受已有 ISO；Depot ZIP 需使用 PowerCLI', 'error', '输入'],
    [/input is not a valid iso9660 image/i, '输入不是有效的 ISO9660 镜像', 'error', '输入'],
    [/input iso is missing esxi boot\.cfg/i, '输入镜像缺少 ESXi BOOT.CFG', 'error', '输入'],
    [/iso version mismatch/i, 'ISO 版本与所选版本不一致', 'error', '输入'],
    [/output already exists; refusing/i, '输出文件已存在，已拒绝覆盖旧产物', 'error', '输出'],
  ]

  const rules: Array<[RegExp, string, ChineseLogKind, string]> = [
    [/starting native .*(iso )?build/i, '启动 Linux 原生重封装引擎', 'step', '引擎'],
    [/^using base iso[:\s]+(.+)$/i, '实际使用的基础镜像：$1', 'step', '镜像'],
    [/^processing driver[:\s]+(.+)$/i, '正在处理驱动包：$1', 'step', '驱动'],
    [/^injected vib[:\s]+(.+)$/i, '已注入 VIB 驱动：$1', 'step', '驱动'],
    [/^injected kernel module[:\s]+(.+)$/i, '已注入内核模块：$1', 'step', '驱动'],
    [/^patching boot\.cfg.*$/i, '正在修改引导配置并生成无人值守安装脚本', 'step', '参数'],
    [/^extracting (base )?iso.*$/i, '正在解包基础镜像', 'step', '解包'],
    [/^extracting and injecting drivers.*$/i, '正在解包并注入驱动', 'step', '驱动'],
    [/iso image produced[:\s]+(\d+).*sectors/i, '镜像已生成，共 $1 个扇区', 'step', '封装'],
    [/^written to medium/i, '镜像已写入输出文件', 'step', '封装'],
    [/^iso created[:\s]+(.+)$/i, '输出的 ISO：$1', 'success', '产物'],
    [/^rebuilding .*iso.*$/i, '正在重新封装可引导镜像', 'step', '封装'],
    [/^starting build\.*$/i, '开始构建', 'step', '构建'],
    [/^cloning profile[:\s]+(.+)$/i, '克隆镜像配置：$1', 'step', '配置'],
    [/^using image profile[:\s]+(.+)$/i, '使用镜像配置：$1', 'step', '配置'],
    [/^exporting iso\.*$/i, '正在导出 ISO', 'step', '导出'],
    [/^export strategy[:\s]+(.+)$/i, '导出方式：$1', 'step', '导出'],
    [/^loading esxi depot/i, '正在加载 ESXi 软件仓库', 'step', '仓库'],
    [/^getting image profile/i, '正在读取镜像配置', 'step', '配置'],
    [/^no esxi image profiles found/i, '软件仓库中没有可用的镜像配置', 'error', '仓库'],
    [/^iso uploaded to (.+)$/i, '定制 ISO 已写入存储：$1', 'success', '入库'],
    [/^enabled boot tweak: cpuUniformityHardCheckPanic=FALSE.*$/i, '已注入 Intel 大小核防紫屏内核参数 (并写入装后持久化)', 'step', '参数'],
    [/^enabled boot tweak: allowLegacyCPU=true.*$/i, '已注入放行老旧 CPU 参数 (allowLegacyCPU=true)', 'step', '参数'],
    [/^enabled boot tweak: autoPartitionOSDataSize=8192.*$/i, '已启用 8GB 精简系统盘 (autoPartitionOSDataSize=8192)', 'step', '参数'],
    [/^enabled boot tweak: ignoreHeadless=TRUE.*$/i, '已启用无头模式引导 (ignoreHeadless=TRUE)', 'step', '参数'],
    [/^done$/i, '该阶段处理完成', 'step', '完成'],
    [/^using .* engine/i, '$&', 'step', '引擎'],
  ]

  for (const [re, text, kind, badge] of scriptRules) {
    if (re.test(trimmed)) {
      return { raw: line, chinese: `${text}`, kind, badge }
    }
  }

  for (const [re, text, kind, badge] of rules) {
    if (re.test(trimmed)) {
      return {
        raw: line,
        chinese: `${trimmed.replace(re, text)}`,
        kind,
        badge,
      }
    }
  }

  if (/iso uploaded to|persisting artifact|artifact saved/i.test(trimmed)) {
    return {
      raw: line,
      chinese: `${trimmed}`,
      kind: 'success',
      badge: '入库',
    }
  }
  if (/build completed successfully|iso generated successfully/i.test(trimmed)) {
    return {
      raw: line,
      chinese: '构建流程已成功结束',
      kind: 'success',
      badge: '完成',
    }
  }

  // 7z 等工具的低价值细节：中文视图忽略，原始日志仍保留
  if (
    /^7-zip|^p7zip|^copyright/i.test(trimmed) ||
    /^-{2,}$/.test(trimmed) ||
    /^(scanning the drive|path = |type = |physical size|created = |modified = |everything is ok|files read from disk|archive size)/i.test(
      trimmed
    ) ||
    /^(folders|files|size|compressed)\s*:/i.test(trimmed) ||
    /^\d+ file(s)?, \d+ bytes/i.test(trimmed) ||
    /^drive current:|^media (current|status|summary)|^added to iso image|^writing to |^xorriso : update|^xorriso [\d.]+ :/i.test(
      trimmed
    )
  ) {
    if (/^type = iso/i.test(trimmed)) {
      return { raw: line, chinese: '确认为 ISO 镜像', kind: 'step', badge: '解包' }
    }
    if (/^physical size = (\d+)/i.test(trimmed)) {
      const size = trimmed.replace(/^physical size = /i, '')
      return { raw: line, chinese: `镜像体积 ${size} 字节`, kind: 'step', badge: '解包', dedupeKey: 'unpack:size' }
    }
    return null
  }

  if (/^extracting archive: (.+)$/i.test(trimmed)) {
    return {
      raw: line,
      chinese: `开始解包：${trimmed.replace(/^extracting archive:\s*/i, '')}`,
      kind: 'step',
      badge: '解包',
    }
  }

  return { raw: line, chinese: trimmed, kind: 'normal', badge: '日志' }
}

function translateProgressText(text: string) {
  const map: Array<[RegExp, string]> = [
    [/extract/i, '正在解包基础镜像'],
    [/inject/i, '正在注入驱动'],
    [/rebuild|repack|export/i, '正在封装镜像'],
    [/persist|upload/i, '正在校验并写入产物'],
    [/build/i, '正在构建'],
    [/complete|done/i, '已完成'],
  ]
  for (const [re, text2] of map) {
    if (re.test(text)) return text2
  }
  return text
}

/** 相邻重复的中文行去掉，保留原始日志视图完整。 */
export function dedupeChineseLogs(logs: Array<FormattedChineseLog | null>) {
  const seenTiming = new Set<string>()
  const out: FormattedChineseLog[] = []
  let lastKey = ''
  for (const item of logs) {
    if (!item) continue
    if (item.dedupeKey) {
      if (seenTiming.has(item.dedupeKey)) continue
      seenTiming.add(item.dedupeKey)
    }
    const key = `${item.kind}:${item.chinese}`
    if (key === lastKey) continue
    lastKey = key
    out.push(item)
  }
  return out
}

/** 内网 HTTP 下 navigator.clipboard 不可用，需要回退方案。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走回退
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
