import api from './client'
import type { BuildPreflight, BuildTask } from '../types'

export interface CreateBuildPayload {
  bucket_id: number
  esxi_version: string
  depot_path: string
  driver_paths: string[]
  custom_iso_name?: string
}

export interface PaginatedBuilds {
  items: BuildTask[]
  page: number
  page_size: number
  total: number
}

export interface StartBuildPreflightPayload {
  bucket_id: number
  depot_path: string
  driver_paths: string[]
}

export async function createBuild(data: CreateBuildPayload): Promise<BuildTask> {
  const response = await api.post('/builds', data)
  return response.data
}

export async function startBuildPreflight(data: StartBuildPreflightPayload): Promise<BuildPreflight> {
  const response = await api.post('/builds/preflight', data)
  return response.data
}

export async function getBuildPreflight(id: string): Promise<BuildPreflight> {
  const response = await api.get(`/builds/preflight/${id}`)
  return response.data
}

export async function listBuilds(page = 1, pageSize = 20): Promise<PaginatedBuilds> {
  const response = await api.get('/builds', { params: { page, page_size: pageSize } })
  return response.data
}

export async function getBuild(taskId: string): Promise<BuildTask> {
  const response = await api.get(`/builds/${taskId}`)
  return response.data
}

export async function deleteBuild(taskId: string): Promise<{ deleted: boolean; task_id: string }> {
  const response = await api.delete(`/builds/${taskId}`)
  return response.data
}

export async function getBuildLogs(taskId: string): Promise<string> {
  const response = await api.get(`/builds/${taskId}/logs`, { responseType: 'text' })
  return typeof response === 'string' ? response : ''
}
