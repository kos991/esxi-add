export function formatBytes(value?: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

export function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function parseDrivers(value?: string) {
  if (!value) return [] as string[]
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function buildPublicObjectUrl(publicDomain?: string, objectPath?: string) {
  if (!publicDomain || !objectPath) return undefined
  const domain = publicDomain.trim()
  const normalizedDomain = domain.includes('://') ? domain : `https://${domain}`
  return `${normalizedDomain.replace(/\/$/, '')}/${objectPath.trim().replace(/^\//, '')}`
}
