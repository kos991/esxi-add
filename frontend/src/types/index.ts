export interface StorageBucket {
  id: number
  name: string
  type?: 's3' | 'local'
  endpoint: string
  access_key: string
  secret_key?: string
  bucket_name: string
  region: string
  use_ssl: boolean
  public_domain: string
  local_path?: string
  is_default: boolean
  created_at: string
  updated_at?: string
}

export interface FileMetadata {
  id: number
  storage_bucket_id: number
  path: string
  type: 'depot' | 'driver' | 'iso'
  esxi_version?: string
  driver_category?: string
  driver_type?: string
  driver_name?: string
  driver_description?: string
  driver_version?: string
  is_latest?: boolean
  conflicts_with?: string
  depends_on?: string
  md5?: string
  sha256?: string
  size?: number
  etag?: string
  last_modified?: string
}

export interface BuildTask {
  id: number
  task_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  storage_bucket_id: number
  esxi_version: string
  depot_path: string
  drivers: string
  custom_iso_name?: string
  progress: number
  log_output?: string
  output_iso?: string
  output_iso_size?: number
  output_iso_sha256?: string
  error_message?: string
  build_duration?: number
  created_at: string
  started_at?: string
  completed_at?: string
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}
