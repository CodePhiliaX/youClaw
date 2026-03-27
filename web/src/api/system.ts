import { apiFetch } from './client'

export interface ChannelStatus {
  name: string
  connected: boolean
}

export interface SystemStatus {
  uptime: number
  platform: string
  nodeVersion: string
  agents: { total: number; active: number }
  telegram: { connected: boolean }
  channels?: ChannelStatus[]
  database: { path: string; sizeBytes: number }
  logsDir?: string
  startedAt: string
}

export async function getSystemStatus() {
  return apiFetch<SystemStatus>('/api/status')
}
