import api from './client'
import type { StorageBucket } from '../types'

export interface BucketPayload {
  name: string
  type?: 's3' | 'local'
  endpoint?: string
  access_key?: string
  secret_key?: string
  bucket_name?: string
  region?: string
  use_ssl?: boolean
  public_domain?: string
  local_path?: string
  is_default?: boolean
}

export async function listBuckets(): Promise<StorageBucket[]> {
  const response = await api.get('/buckets')
  return response.data
}

export async function createBucket(data: BucketPayload): Promise<StorageBucket> {
  const response = await api.post('/buckets', data)
  return response.data
}

export async function updateBucket(id: number, data: BucketPayload): Promise<StorageBucket> {
  const response = await api.put(`/buckets/${id}`, data)
  return response.data
}

export async function deleteBucket(id: number): Promise<{ deleted: boolean }> {
  const response = await api.delete(`/buckets/${id}`)
  return response.data
}

export async function testBucketConnection(id: number): Promise<{ connected: boolean }> {
  const response = await api.post(`/buckets/${id}/test`)
  return response.data
}

export async function setDefaultBucket(id: number): Promise<{ is_default: boolean; id: number }> {
  const response = await api.put(`/buckets/${id}/default`)
  return response.data
}
