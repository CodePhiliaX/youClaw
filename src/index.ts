// 清除 CLAUDECODE 环境变量，避免 Claude Agent SDK 检测到嵌套 session 而拒绝运行
delete process.env.CLAUDECODE

import { loadEnv, getEnv } from './config/index.ts'
import { initLogger, getLogger } from './logger/index.ts'
import { initDatabase, createTask, updateTask, deleteTask, getTasks, getTask } from './db/index.ts'
import { EventBus } from './events/index.ts'
import { AgentManager, AgentQueue, PromptBuilder, AgentCompiler, AgentRouter, HooksManager, SecretsManager } from './agent/index.ts'
import { MessageRouter, ChannelManager } from './channel/index.ts'
import { SkillsLoader, SkillsWatcher, RegistryManager } from './skills/index.ts'
import { MemoryManager, MemoryIndexer } from './memory/index.ts'
import { Scheduler } from './scheduler/index.ts'
import { IpcWatcher, refreshTasksSnapshot } from './ipc/index.ts'
import { createApp } from './routes/index.ts'

async function main() {
  // 1. 加载环境变量
  loadEnv()
  const env = getEnv()

  // 2. 初始化日志
  const logger = initLogger()
  logger.info('YouClaw 启动中...')

  // 3. 初始化数据库
  initDatabase()

  // 4. 创建 EventBus
  const eventBus = new EventBus()

  // 5. 创建 SkillsLoader 和 SkillsWatcher
  const skillsLoader = new SkillsLoader()
  logger.info({ count: skillsLoader.loadAllSkills().length }, 'Skills 加载完成')

  const skillsWatcher = new SkillsWatcher(skillsLoader, {
    onReload: (skills) => {
      logger.info({ count: skills.length }, 'Skills 热更新完成')
    },
  })
  skillsWatcher.start()

  // 5b. 创建 RegistryManager
  const registryManager = new RegistryManager(skillsLoader)

  // 6. 创建 MemoryManager 和 MemoryIndexer
  const memoryManager = new MemoryManager()
  let memoryIndexer: MemoryIndexer | null = null
  try {
    memoryIndexer = new MemoryIndexer()
    memoryIndexer.initTable()
    memoryIndexer.rebuildIndex()
    logger.info('记忆搜索索引已构建')
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'FTS5 索引初始化失败，搜索功能不可用')
  }

  // 7. 创建 SecretsManager
  const secretsManager = new SecretsManager()
  secretsManager.loadFromEnv()

  // 8. 创建 HooksManager
  const hooksManager = new HooksManager()

  // 9. 创建 PromptBuilder、AgentCompiler、AgentRouter
  const promptBuilder = new PromptBuilder(skillsLoader, memoryManager)
  const compiler = new AgentCompiler(promptBuilder)
  const agentRouter = new AgentRouter()

  // 10. 创建 AgentManager（注入所有新模块）
  const agentManager = new AgentManager(
    eventBus,
    promptBuilder,
    compiler,
    hooksManager,
    agentRouter,
    secretsManager,
  )
  await agentManager.loadAgents()

  // 11. 创建 AgentQueue
  const agentQueue = new AgentQueue(agentManager)

  // 12. 创建 MessageRouter（带 MemoryManager）
  const router = new MessageRouter(agentManager, agentQueue, eventBus, memoryManager, skillsLoader)

  // 13. 创建 ChannelManager 并加载 channels
  const channelManager = new ChannelManager(router, (msg) => router.handleInbound(msg), eventBus)
  await channelManager.seedFromEnv(env)     // 首次启动从 env 迁移
  await channelManager.loadFromDatabase()   // 加载并连接所有 enabled channel

  // 14. 创建 Scheduler 并启动
  const scheduler = new Scheduler(agentQueue, agentManager, eventBus)
  scheduler.start()
  logger.info('定时任务调度器已启动')

  // 15. 创建 IPC Watcher 并启动
  const ipcWatcher = new IpcWatcher({
    onScheduleTask: (data) => {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const nextRun = scheduler.calculateNextRun({
        schedule_type: data.scheduleType,
        schedule_value: data.scheduleValue,
        last_run: null,
      })

      createTask({
        id: taskId,
        agentId: data.agentId,
        chatId: data.chatId,
        prompt: data.prompt,
        scheduleType: data.scheduleType,
        scheduleValue: data.scheduleValue,
        nextRun: nextRun ?? new Date().toISOString(),
        name: data.name,
        description: data.description,
        deliveryMode: data.deliveryMode,
        deliveryTarget: data.deliveryTarget,
      })

      // 写入快照
      refreshSnapshot(data.agentId)
      logger.info({ taskId, agentId: data.agentId, scheduleType: data.scheduleType }, 'IPC: 定时任务已创建')
    },
    onPauseTask: (taskId) => {
      const task = getTask(taskId)
      if (task) {
        updateTask(taskId, { status: 'paused' })
        refreshSnapshot(task.agent_id)
        logger.info({ taskId }, 'IPC: 定时任务已暂停')
      } else {
        logger.warn({ taskId }, 'IPC: 暂停失败，任务不存在')
      }
    },
    onResumeTask: (taskId) => {
      const task = getTask(taskId)
      if (task) {
        const nextRun = scheduler.calculateNextRun({
          schedule_type: task.schedule_type,
          schedule_value: task.schedule_value,
          last_run: task.last_run,
        })
        updateTask(taskId, { status: 'active', nextRun: nextRun ?? new Date().toISOString() })
        refreshSnapshot(task.agent_id)
        logger.info({ taskId }, 'IPC: 定时任务已恢复')
      } else {
        logger.warn({ taskId }, 'IPC: 恢复失败，任务不存在')
      }
    },
    onCancelTask: (taskId) => {
      const task = getTask(taskId)
      if (task) {
        deleteTask(taskId)
        refreshSnapshot(task.agent_id)
        logger.info({ taskId }, 'IPC: 定时任务已取消')
      } else {
        logger.warn({ taskId }, 'IPC: 取消失败，任务不存在')
      }
    },
  })
  ipcWatcher.start()
  logger.info('IPC Watcher 已启动')

  /** 刷新指定 agent 的任务快照 */
  function refreshSnapshot(agentId: string) {
    refreshTasksSnapshot(agentId, getTasks)
  }

  // 16. 启动时记忆维护：日志清理 + 快照恢复
  for (const agentConfig of agentManager.getAgents()) {
    memoryManager.pruneOldLogs(agentConfig.id, 30)
    memoryManager.restoreFromSnapshot(agentConfig.id)
  }

  // 17. 创建 HTTP 服务
  const app = createApp({ agentManager, agentQueue, eventBus, router, channelManager, skillsLoader, registryManager, memoryManager, memoryIndexer, scheduler })

  const server = Bun.serve({
    fetch: app.fetch,
    port: env.PORT,
    hostname: '127.0.0.1',  // 只监听本地，避免 Windows 防火墙弹窗
  })

  logger.info({ port: env.PORT }, `HTTP 服务已启动: http://localhost:${env.PORT}`)
  logger.info('YouClaw 已就绪')

  // 18. 优雅关闭
  const shutdown = async () => {
    logger.info('正在关闭...')
    await channelManager.disconnectAll()
    skillsWatcher.stop()
    ipcWatcher.stop()
    scheduler.stop()
    server.stop()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('启动失败:', err)
  process.exit(1)
})
