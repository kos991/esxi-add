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

export function assetTypeText(file: FileMetadata) {
  if (file.path.toLowerCase().startsWith('output/')) return '构建产出 ISO'
  if (file.type === 'depot') return '基础源 (Depot/ISO)'
  if (file.type === 'driver') return '驱动包 (VIB/ZIP)'
  return '普通 ISO'
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

export function compactSize(value?: number) {
  return value ? formatBytes(value) : '-'
}

export interface FormattedChineseLog {
  raw: string
  chinese: string
  kind: 'timing' | 'progress' | 'step' | 'success' | 'warn' | 'error' | 'normal'
  badge: string
}

export function formatLogToChinese(line: string): FormattedChineseLog {
  const trimmed = line.trim()
  const lower = trimmed.toLowerCase()

  // 1. [TIMING] 耗时分解指标项
  const timingMatch = trimmed.match(/^\[TIMING\]\s+([a-zA-Z0-9_]+)=(\d+)/)
  if (timingMatch) {
    const key = timingMatch[1]
    const ms = parseInt(timingMatch[2], 10)
    const sec = (ms / 1000).toFixed(2)
    let label = '阶段耗时'
    if (key === 'input_prepare_ms') label = '基础镜像源与输入参数校验准备完成'
    else if (key === 'iso_extract_ms') label = '原版 ESXi 基础 ISO 镜像解包完成'
    else if (key === 'powercli_load_ms') label = 'PowerCLI 镜像构建环境初始化完成'
    else if (key === 'depot_profile_ms') label = 'Depot 离线包与镜像 Profile 克隆完成'
    else if (key === 'driver_injection_ms' || key === 'driver_inject_ms')
      label = '社区驱动包与 kickstart 自动安装配置注入完成'
    else if (key === 'iso_export_ms' || key === 'iso_rebuild_ms')
      label = 'xorriso 原生极速重封装可引导 ISO 镜像完成'
    else if (key === 'artifact_persist_ms')
      label = '产物 SHA-256 流式校验与持久化落盘入库完成'
    else label = `阶段 ${key} 执行完成`

    return {
      raw: line,
      chinese: `⏱️【阶段耗时】${label}（耗时 ${sec} 秒 / ${ms} 毫秒）`,
      kind: 'timing',
      badge: '耗时指标',
    }
  }

  // 2. [PROGRESS] 进度汇报
  const progressMatch = trimmed.match(/^\[PROGRESS\]\s+(\d+)\s*(.*)/)
  if (progressMatch) {
    const pct = progressMatch[1]
    let desc = progressMatch[2]?.trim() || ''
    if (desc.includes('building')) desc = '正在执行镜像处理...'
    if (desc.includes('extracting')) desc = '正在解压基础 ISO...'
    if (desc.includes('injecting')) desc = '正在注入网卡与存储驱动...'
    if (desc.includes('rebuilding')) desc = '正在生成可引导镜像...'
    if (desc.includes('persisting')) desc = '正在校验并写入产物...'
    if (desc.includes('complete') || desc.includes('done')) desc = '流水线构建已完成'
    return {
      raw: line,
      chinese: `📊【构建进度】流水线当前已推进至 ${pct}%${desc ? ` — ${desc}` : ''}`,
      kind: 'progress',
      badge: '进度更新',
    }
  }

  // 3. 关键动作步骤项
  if (lower.includes('starting native linux iso rebuild') || lower.includes('starting linux native')) {
    return {
      raw: line,
      chinese: '⚡【引擎启动】启动 Linux 原生极速重封装引擎（预计 5~10 秒完成）',
      kind: 'step',
      badge: '引擎启动',
    }
  }
  if (lower.includes('extracting base iso') || lower.includes('extracting iso')) {
    return {
      raw: line,
      chinese: '📦【镜像解包】正在解开官方原版 ESXi 安装镜像目录树与引导卷...',
      kind: 'step',
      badge: '镜像解包',
    }
  }
  if (lower.includes('injecting community driver') || lower.includes('injecting driver')) {
    return {
      raw: line,
      chinese: '🧩【驱动注入】正在注入社区驱动包并配置自动加载脚本...',
      kind: 'step',
      badge: '驱动注入',
    }
  }
  if (lower.includes('rebuilding bootable iso') || lower.includes('xorriso')) {
    return {
      raw: line,
      chinese: '💿【系统封装】调用 xorriso 重新封装生成兼容 UEFI / BIOS 的引导镜像...',
      kind: 'step',
      badge: '镜像重构',
    }
  }
  if (lower.includes('iso uploaded to') || lower.includes('persisting artifact') || lower.includes('artifact saved')) {
    const dest = trimmed.replace(/.*(?:uploaded to|saved to|artifact:)s*/i, '')
    return {
      raw: line,
      chinese: `🎉【产物入库】定制 ESXi ISO 已成功持久化至存储：${dest || 'output 目录'}`,
      kind: 'success',
      badge: '产物就绪',
    }
  }
  if (lower.includes('iso generated successfully') || lower.includes('build completed successfully')) {
    return {
      raw: line,
      chinese: '✅【流水线成功】所有阶段均已顺利通过，定制 ISO 镜像已生成，可直接下载！',
      kind: 'success',
      badge: '构建成功',
    }
  }

  // 4. 错误与警告
  if (lower.includes('error') || lower.includes('failed') || lower.includes('fatal')) {
    return {
      raw: line,
      chinese: `❌【异常报错】${trimmed}`,
      kind: 'error',
      badge: '异常错误',
    }
  }
  if (lower.includes('warn')) {
    return {
      raw: line,
      chinese: `⚠️【运行警告】${trimmed}`,
      kind: 'warn',
      badge: '状态警告',
    }
  }

  // 5. 普通信息
  return {
    raw: line,
    chinese: trimmed,
    kind: 'normal',
    badge: '执行日志',
  }
}
