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

export async function uploadFile(
  bucketId: number,
  type: 'depot' | 'driver' | 'iso',
  file: File,
  esxiVersion?: string,
  category?: string
): Promise<FileMetadata> {
  const formData = new FormData()
  formData.append('bucket_id', String(bucketId))
  formData.append('type', type)
  formData.append('file', file)
  if (esxiVersion) formData.append('esxi_version', esxiVersion)
  if (category) formData.append('category', category)

  const response = await api.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
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
