import { Hono } from 'hono'
import { existsSync, statSync } from 'node:fs'
import { getPaths } from '../config/paths.ts'
import type { AgentManager } from '../agent/index.ts'
import type { EventBus } from '../events/index.ts'
import type { MessageRouter } from '../channel/index.ts'

const startedAt = new Date().toISOString()

export function createSystemRoutes(agentManager: AgentManager, eventBus: EventBus, router: MessageRouter) {
  // suppress unused parameter lint — eventBus reserved for future use
  void eventBus

  const system = new Hono()

  // GET /api/status — system status info
  system.get('/status', async (c) => {
    const paths = getPaths()

    // Agent statistics
    const agents = agentManager.getAgents()
    const allManaged = agents.map((cfg) => agentManager.getAgent(cfg.id))
    const activeCount = allManaged.filter(
      (m) => m?.state.isProcessing,
    ).length

    // Database size
    let dbSizeBytes = 0
    if (existsSync(paths.db)) {
      dbSizeBytes = statSync(paths.db).size
    }

    // Channel connection status
    const channels = router.getChannelStatuses()

    // Backward compatibility: keep telegram field
    const telegramConnected = channels.some((ch) => ch.name === 'telegram' && ch.connected)

    return c.json({
      uptime: Math.floor(process.uptime()),
      platform: process.platform,
      nodeVersion: `bun ${Bun.version}`,
      agents: {
        total: agents.length,
        active: activeCount,
      },
      telegram: {
        connected: telegramConnected,
      },
      channels,
      database: {
        path: paths.db,
        sizeBytes: dbSizeBytes,
      },
      startedAt,
    })
  })

  return system
}
