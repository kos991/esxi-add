import api from './client'
import type { FileMetadata } from '../types'

export async function listDepots(bucketId: number, esxiVersion?: string): Promise<FileMetadata[]> {
  const response = await api.get('/files/depots', { params: { bucket_id: bucketId, esxi_version: esxiVersion } })
  return response.data
}

export async function listDrivers(bucketId: number, esxiVersion?: string, category?: string): Promise<FileMetadata[]> {
  const response = await api.get('/files/drivers', {
    params: { bucket_id: bucketId, esxi_version: esxiVersion, category },
  })
  return response.data
}

export async function listISOs(bucketId: number): Promise<FileMetadata[]> {
  const response = await api.get('/files/isos', { params: { bucket_id: bucketId } })
  return response.data
}

/** 列出节点下全部已索引文件（含未归入固定目录的条目）。 */
export async function listAllFiles(bucketId: number): Promise<FileMetadata[]> {
  const response = await api.get('/files', { params: { bucket_id: bucketId } })
  return response.data
}

export async function uploadFile(
  bucketId: number,
  type: 'depot' | 'driver' | 'iso',
  file: File,
  esxiVersion?: string,
  category?: string,
  onProgress?: (percent: number, loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<FileMetadata> {
  const formData = new FormData()
  formData.append('bucket_id', String(bucketId))
  formData.append('type', type)
  formData.append('file', file)
  if (esxiVersion) formData.append('esxi_version', esxiVersion)
  if (category) formData.append('category', category)

  const response = await api.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    signal,
    onUploadProgress: (event) => {
      if (!onProgress) return
      const total = event.total ?? file.size
      const loaded = event.loaded ?? 0
      const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0
      onProgress(percent, loaded, total)
    },
  })
  return response.data
}

export async function deleteFile(id: number): Promise<{ deleted: boolean }> {
  const response = await api.delete(`/files/${id}`)
  return response.data
}

export async function renameFile(id: number, name: string): Promise<FileMetadata> {
  const response = await api.put(`/files/${id}/rename`, { name })
  return response.data
}

export async function refreshFiles(bucketId: number): Promise<{ refreshed: boolean; bucket_id: number }> {
  const response = await api.post('/files/refresh', null, { params: { bucket_id: bucketId } })
  return response.data
}

/** 带鉴权头的文件下载：不依赖 window.open，内网 HTTP 下也能工作。 */
export async function downloadFile(id: number, name: string): Promise<void> {
  const response = await api.get(`/files/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(response as unknown as Blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export interface PresignedFileUrlResult {
  url: string
  signed: boolean
  expires_seconds: number
  object_path: string
  filename: string
}

export async function getFilePresignedUrl(
  id: number,
  expiresSeconds = 86400
): Promise<PresignedFileUrlResult> {
  const response = await api.get(`/files/${id}/presign`, {
    params: { expires: expiresSeconds },
  })
  return response.data
}

export interface ArchiveFileResult {
  file: FileMetadata
  source_bucket_id: number
  target_bucket_id: number
  target_bucket_name: string
  cleaned_local: boolean
  freed_bytes: number
}

export interface ArchiveOutputsResult {
  transferred_count: number
  freed_bytes: number
  target_bucket_id: number
  target_bucket_name: string
  paths: string[]
}

export async function archiveFileToS3(
  id: number,
  targetBucketId?: number
): Promise<ArchiveFileResult> {
  const response = await api.post(`/files/${id}/archive-s3`, {
    target_bucket_id: targetBucketId,
  })
  return response.data
}

export async function archiveOutputsToS3(
  sourceBucketId?: number,
  targetBucketId?: number
): Promise<ArchiveOutputsResult> {
  const response = await api.post('/files/archive-outputs-s3', {
    source_bucket_id: sourceBucketId,
    target_bucket_id: targetBucketId,
  })
  return response.data
}
