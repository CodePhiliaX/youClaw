// Remove CLAUDECODE env var to prevent Claude Agent SDK from detecting a nested session
delete process.env.CLAUDECODE

import { appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { loadEnv, getEnv } from './config/index.ts'
import { initLogger, getLogger } from './logger/index.ts'
import { initDatabase } from './db/index.ts'
import { EventBus } from './events/index.ts'
import { AgentManager, AgentQueue, PromptBuilder, AgentCompiler, AgentRouter, HooksManager, SecretsManager } from './agent/index.ts'
import { MessageRouter, ChannelManager } from './channel/index.ts'
import { registerChannelOutboundService } from './channel/outbound-service.ts'
import { SkillsLoader, SkillsWatcher, RegistryManager } from './skills/index.ts'
import { MemoryManager, MemoryIndexer } from './memory/index.ts'
import { Scheduler } from './scheduler/index.ts'
import { IpcWatcher } from './ipc/index.ts'
import { BrowserManager } from './browser/index.ts'
import { createApp } from './routes/index.ts'
import {
  TaskServiceError,
  createScheduledTask,
  deleteScheduledTaskById,
  pauseScheduledTaskById,
  resumeScheduledTaskById,
} from './task/index.ts'

async function main() {
  // 1. Load environment variables
  let env: ReturnType<typeof getEnv>
  try {
    loadEnv()
    env = getEnv()
  } catch (err) {
    console.error('[STARTUP] Step 1 failed: load env', err)
    throw err
  }

  // 2. Initialize logger
  const logger = initLogger()
  logger.info('YouClaw starting...')

  // 3. Initialize database
  try {
    initDatabase()
    logger.info('Database initialized')
  } catch (err) {
    logger.error({ err }, '[STARTUP] Step 3 failed: init database')
    throw err
  }

  // 4. Create EventBus
  const eventBus = new EventBus()

  // 4b. Initialize browser subsystem and ensure the default managed profile exists
  const browserManager = new BrowserManager()
  try {
    browserManager.ensureDefaultProfile()
    logger.info('Browser manager initialized')
  } catch (err) {
    logger.error({ err }, '[STARTUP] Step 4b failed: init browser manager')
    throw err
  }

  // 5. Create SkillsLoader and SkillsWatcher
  let skillsLoader: SkillsLoader
  try {
    skillsLoader = new SkillsLoader()
    logger.info({ count: skillsLoader.loadAllSkills().length }, 'Skills loaded')
  } catch (err) {
    logger.error({ err }, '[STARTUP] Step 5 failed: load skills')
    throw err
  }

  let agentManagerRef: AgentManager | null = null
  const skillsWatcher = new SkillsWatcher(skillsLoader, {
    onReload: (skills) => {
      logger.info({ count: skills.length }, 'Skills hot-reloaded')
      agentManagerRef?.syncAllAgentSkills()
    },
  })
  skillsWatcher.start()

  // 5b. Create RegistryManager
  const registryManager = new RegistryManager(skillsLoader)

  // 6. Create MemoryManager and MemoryIndexer
  let memoryManager: MemoryManager
  try {
    memoryManager = new MemoryManager()
    logger.info('Memory manager initialized')
  } catch (err) {
    logger.error({ err }, '[STARTUP] Step 6 failed: init memory manager')
    throw err
  }
  let memoryIndexer: MemoryIndexer | null = null
  try {
    memoryIndexer = new MemoryIndexer()
    memoryIndexer.initTable()
    memoryIndexer.rebuildIndex()
    logger.info('Memory search index built')
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'FTS5 index init failed, search unavailable')
  }

  // 7. Create SecretsManager
  const secretsManager = new SecretsManager()
  try {
    secretsManager.loadFromEnv()
  } catch (err) {
    logger.error({ err }, '[STARTUP] Step 7 failed: init secrets manager')
    throw err
  }

  // 8. Create HooksManager
  const hooksManager = new HooksManager()

  // 9. Create PromptBuilder, AgentCompiler, AgentRouter
  const promptBuilder = new PromptBuilder(skillsLoader, memoryManager)
  const compiler = new AgentCompiler(promptBuilder)
  const agentRouter = new AgentRouter()

  // 10. Create AgentManager (inject all new modules)
  let agentManager: AgentManager
  try {
    agentManager = new AgentManager(
      eventBus,
      promptBuilder,
      compiler,
      hooksManager,
      agentRouter,
      secretsManager,
      skillsLoader,
      browserManager,
    )
    await agentManager.loadAgents()
    agentManagerRef = agentManager
    logger.info({ count: agentManager.getAgents().length }, 'Agents loaded')
  } catch (err) {
    logger.error({ err }, '[STARTUP] Step 10 failed: init agent manager / load agents')
    throw err
  }

  // 11. Create AgentQueue
  const agentQueue = new AgentQueue(agentManager)

  // 12. Create MessageRouter (with MemoryManager)
  const router = new MessageRouter(agentManager, agentQueue, eventBus, memoryManager, skillsLoader)

  // 13. Create ChannelManager and load channels
  let channelManager: ChannelManager
  try {
    channelManager = new ChannelManager(router, (msg) => router.handleInbound(msg), eventBus)
    await channelManager.seedFromEnv(env)     // Migrate from env on first launch
    await channelManager.loadFromDatabase()   // Load and connect all enabled channels
    registerChannelOutboundService(channelManager)
    logger.info('Channels loaded')
  } catch (err) {
    logger.error({ err }, '[STARTUP] Step 13 failed: init channel manager')
    throw err
  }

  // 14. Create Scheduler and start
  const scheduler = new Scheduler(agentQueue, agentManager, eventBus)
  scheduler.start()
  logger.info('Task scheduler started')

  // 15. Create IPC Watcher and start
  const ipcWatcher = new IpcWatcher({
    onScheduleTask: (data) => {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      createScheduledTask({
        id: taskId,
        agentId: data.agentId,
        chatId: data.chatId,
        prompt: data.prompt,
        scheduleType: data.scheduleType as 'cron' | 'interval' | 'once',
        scheduleValue: data.scheduleValue,
        name: data.name,
        description: data.description,
        timezone: data.timezone,
        deliveryMode: data.deliveryMode as 'push' | 'none' | undefined,
        deliveryTarget: data.deliveryTarget,
      })
      logger.info({ taskId, agentId: data.agentId, scheduleType: data.scheduleType }, 'IPC: scheduled task created')
    },
    onPauseTask: (taskId) => {
      try {
        pauseScheduledTaskById(taskId)
        logger.info({ taskId }, 'IPC: scheduled task paused')
      } catch (err) {
        if (err instanceof TaskServiceError && err.statusCode === 404) {
          logger.warn({ taskId }, 'IPC: pause failed, task not found')
          return
        }
        throw err
      }
    },
    onResumeTask: (taskId) => {
      try {
        resumeScheduledTaskById(taskId)
        logger.info({ taskId }, 'IPC: scheduled task resumed')
      } catch (err) {
        if (err instanceof TaskServiceError && err.statusCode === 404) {
          logger.warn({ taskId }, 'IPC: resume failed, task not found')
          return
        }
        throw err
      }
    },
    onCancelTask: (taskId) => {
      try {
        deleteScheduledTaskById(taskId)
        logger.info({ taskId }, 'IPC: scheduled task cancelled')
      } catch (err) {
        if (err instanceof TaskServiceError && err.statusCode === 404) {
          logger.warn({ taskId }, 'IPC: cancel failed, task not found')
          return
        }
        throw err
      }
    },
  })
  ipcWatcher.start()
  logger.info('IPC Watcher started')

  // 16. Startup memory maintenance: log cleanup + snapshot restore
  for (const agentConfig of agentManager.getAgents()) {
    memoryManager.pruneOldLogs(agentConfig.id, 30)
    memoryManager.restoreFromSnapshot(agentConfig.id)
  }

  // 17. Create HTTP server
  const app = createApp({ agentManager, agentQueue, eventBus, router, channelManager, skillsLoader, registryManager, memoryManager, memoryIndexer, scheduler, browserManager })

  let server: ReturnType<typeof Bun.serve>
  try {
    server = Bun.serve({
      fetch: app.fetch,
      port: env.PORT,
      hostname: '127.0.0.1',  // Listen on localhost only to avoid Windows firewall prompts
      idleTimeout: 255,       // Max idle timeout (seconds) for SSE/long-running requests
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Bun may emit different messages depending on platform:
    //   "Failed to start server. Is port X in use?" (Windows)
    //   "address already in use" (Unix)
    const isPortConflict = msg.includes('address already in use') || msg.includes('Failed to start server')
    if (isPortConflict) {
      logger.error({ port: env.PORT }, `Port ${env.PORT} is already in use`)
      console.error(`[PORT_CONFLICT] Port ${env.PORT} is already in use`)
      process.exit(1)
    }
    throw err
  }

  logger.info({ port: env.PORT }, `HTTP server started: http://localhost:${env.PORT}`)
  logger.info('YouClaw ready')

  // 18. Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...')
    await channelManager.disconnectAll()
    await browserManager.shutdown().catch(() => {})
    skillsWatcher.stop()
    ipcWatcher.stop()
    scheduler.stop()
    server.stop()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

function writeStartupCrashLog(errorText: string): void {
  try {
    const baseDir = process.env.DATA_DIR
      ? resolve(process.env.DATA_DIR)
      : resolve(tmpdir(), 'youclaw-data')
    mkdirSync(baseDir, { recursive: true })
    const logPath = resolve(baseDir, 'startup-crash.log')
    const line = `[${new Date().toISOString()}] ${errorText}\n`
    appendFileSync(logPath, line, 'utf-8')
  } catch {
    // best-effort only
  }
}

main().catch((err) => {
  const errorText = err instanceof Error ? err.stack ?? err.message : String(err)
  const context = [
    `PORT=${process.env.PORT ?? '(unset)'}`,
    `DATA_DIR=${process.env.DATA_DIR ?? '(unset)'}`,
    `TEMP=${process.env.TEMP ?? '(unset)'}`,
    `BUN_TMPDIR=${process.env.BUN_TMPDIR ?? '(unset)'}`,
  ].join(' ')
  console.error('[STARTUP] Fatal error:', errorText)
  writeStartupCrashLog(`[context: ${context}] ${errorText}`)
  process.exit(1)
})
