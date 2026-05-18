import api from './client'

export interface SystemStatus {
  timestamp: string
  source: string
  cpu: {
    cores: number
    usage_percent: number
  }
  memory: {
    total_bytes: number
    used_bytes: number
    free_bytes: number
    usage_percent: number
  }
  network: {
    rx_bytes: number
    tx_bytes: number
    rx_bytes_per_sec: number
    tx_bytes_per_sec: number
  }
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const response = await api.get('/system/status')
  return response.data
}
