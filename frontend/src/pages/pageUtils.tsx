import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, SyncOutlined } from '@ant-design/icons'
import { Tag } from 'antd'
import type { ReactNode } from 'react'
import type { BuildTask, FileMetadata, StorageBucket } from '../types'
import { formatBytes } from '../utils'

export const esxiVersions = ['6.5', '6.7', '7.0', '8.0', '9.0']

export function buildStatusText(status: BuildTask['status']) {
  const labels: Record<BuildTask['status'], string> = {
    pending: '等待中',
    running: '构建中',
    completed: '已完成',
    failed: '失败',
  }
  return labels[status]
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
    <Tag color={color[status]} icon={icon[status]}>
      {buildStatusText(status)}
    </Tag>
  )
}

export function bucketType(bucket?: StorageBucket) {
  return bucket?.type === 'local' ? 'local' : 's3'
}

export function bucketLocation(bucket?: StorageBucket) {
  if (!bucket) return '-'
  return bucketType(bucket) === 'local' ? bucket.local_path || '-' : bucket.endpoint || '-'
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
  if (file.path.toLowerCase().startsWith('output/')) return '构建产物'
  if (file.type === 'depot') return 'Depot'
  if (file.type === 'driver') return '驱动'
  return 'ISO'
}

export function cacheStatusText(file: FileMetadata, bucket?: StorageBucket) {
  if (bucketType(bucket) === 'local') return '本地可用'
  if (file.cache_status === 'cached' || file.cached) return '已缓存'
  if (file.cache_status === 'stale') return '需更新'
  if (file.cache_status === 'invalid' || file.cache_valid === false) return '无效'
  return '未缓存'
}

export function cacheStatusColor(file: FileMetadata, bucket?: StorageBucket) {
  const status = cacheStatusText(file, bucket)
  if (status === '已缓存' || status === '本地可用') return 'success'
  if (status === '需更新') return 'warning'
  if (status === '无效') return 'error'
  return 'default'
}

export function compactSize(value?: number) {
  return value ? formatBytes(value) : '-'
}
