import { Hono } from 'hono'
import { existsSync, statSync } from 'node:fs'
import { getPaths } from '../config/paths.ts'
import { getEnv } from '../config/env.ts'
import type { AgentManager } from '../agent/index.ts'
import type { EventBus } from '../events/index.ts'

const startedAt = new Date().toISOString()

export function createSystemRoutes(agentManager: AgentManager, eventBus: EventBus) {
  // suppress unused parameter lint — eventBus reserved for future use
  void eventBus

  const system = new Hono()

  // GET /api/status — 系统状态信息
  system.get('/status', async (c) => {
    const paths = getPaths()
    const env = getEnv()

    // Agent 统计
    const agents = agentManager.getAgents()
    const allManaged = agents.map((cfg) => agentManager.getAgent(cfg.id))
    const activeCount = allManaged.filter(
      (m) => m?.state.isProcessing,
    ).length

    // 数据库大小
    let dbSizeBytes = 0
    if (existsSync(paths.db)) {
      dbSizeBytes = statSync(paths.db).size
    }

    // Telegram 连接状态
    const telegramConnected = Boolean(env.TELEGRAM_BOT_TOKEN)

    return c.json({
      uptime: Math.floor(process.uptime()),
      platform: process.platform,
      nodeVersion: `node ${process.version}`,
      agents: {
        total: agents.length,
        active: activeCount,
      },
      telegram: {
        connected: telegramConnected,
      },
      database: {
        path: paths.db,
        sizeBytes: dbSizeBytes,
      },
      startedAt,
    })
  })

  return system
}
