import { describe, test, expect } from 'bun:test'
import './setup.ts'
import { createSystemRoutes } from '../src/routes/system.ts'
import { EventBus } from '../src/events/bus.ts'

describe('system routes', () => {
  test('GET /status returns aggregated system status', async () => {
    const app = createSystemRoutes(
      {
        getAgents: () => [
          { id: 'agent-1', name: 'Agent 1' },
          { id: 'agent-2', name: 'Agent 2' },
        ],
        getAgent: (id: string) => {
          if (id === 'agent-1') {
            return { state: { isProcessing: true } }
          }
          if (id === 'agent-2') {
            return { state: { isProcessing: false } }
          }
          return undefined
        },
      } as any,
      new EventBus(),
      {
        getChannelStatuses: () => [],
      } as any,
    )

    const res = await app.request('/status')
    const body = await res.json() as {
      uptime: number
      platform: string
      nodeVersion: string
      agents: { total: number; active: number }
      telegram: { connected: boolean }
      database: { path: string; sizeBytes: number }
      startedAt: string
    }

    expect(res.status).toBe(200)
    expect(body.agents).toEqual({ total: 2, active: 1 })
    expect(body.platform).toBe(process.platform)
    expect(body.nodeVersion.startsWith('bun ')).toBe(true)
    // mock router returns empty channels, so telegram.connected is false
    expect(body.telegram.connected).toBe(false)
    expect(body.database.path.endsWith('youclaw.db')).toBe(true)
    expect(body.database.sizeBytes).toBeGreaterThanOrEqual(0)
    expect(typeof body.startedAt).toBe('string')
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })
})
