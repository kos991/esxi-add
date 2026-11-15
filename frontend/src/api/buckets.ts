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

export interface BucketTestResult {
  connected: boolean
  capabilities?: {
    list?: boolean
    read?: string
    write?: string
    persistent?: string
  }
  message?: string
}

/** 挂载前测试。传 id 时后端会沿用已保存的密钥，避免留空导致误判失败。 */
export async function testBucketConfig(data: BucketPayload & { id?: number }): Promise<BucketTestResult> {
  const response = await api.post('/buckets/test-config', data)
  return response.data
}
