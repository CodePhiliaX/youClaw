import { loadEnv, getEnv } from './config/index.ts'
import { initLogger, getLogger } from './logger/index.ts'
import { initDatabase, createTask, updateTask, deleteTask, getTasks, getTask } from './db/index.ts'
import { EventBus } from './events/index.ts'
import { AgentManager, AgentQueue, PromptBuilder } from './agent/index.ts'
import { MessageRouter, TelegramChannel } from './channel/index.ts'
import { SkillsLoader, SkillsWatcher } from './skills/index.ts'
import { MemoryManager } from './memory/index.ts'
import { Scheduler } from './scheduler/index.ts'
import { IpcWatcher, writeTasksSnapshot } from './ipc/index.ts'
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

  // 6. 创建 MemoryManager
  const memoryManager = new MemoryManager()

  // 7. 创建 PromptBuilder 和 AgentManager
  const promptBuilder = new PromptBuilder(skillsLoader, memoryManager)
  const agentManager = new AgentManager(eventBus, promptBuilder)
  await agentManager.loadAgents()

  // 8. 创建 AgentQueue
  const agentQueue = new AgentQueue(agentManager)

  // 9. 创建 MessageRouter（带 MemoryManager）
  const router = new MessageRouter(agentManager, agentQueue, eventBus, memoryManager, skillsLoader)

  // 10. 如果有 TELEGRAM_BOT_TOKEN，创建 TelegramChannel 并连接
  if (env.TELEGRAM_BOT_TOKEN) {
    const telegramChannel = new TelegramChannel(env.TELEGRAM_BOT_TOKEN, {
      onMessage: (message) => router.handleInbound(message),
    })
    router.addChannel(telegramChannel)

    telegramChannel.connect().catch((err) => {
      logger.error({ error: err }, 'Telegram 连接失败')
    })
    logger.info('Telegram channel 已配置')
  } else {
    logger.info('未配置 TELEGRAM_BOT_TOKEN，跳过 Telegram channel')
  }

  // 11. 创建 Scheduler 并启动
  const scheduler = new Scheduler(agentQueue, agentManager, eventBus)
  scheduler.start()
  logger.info('定时任务调度器已启动')

  // 12. 创建 IPC Watcher 并启动
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
      })

      // 写入快照
      refreshTasksSnapshot(data.agentId)
      logger.info({ taskId, agentId: data.agentId, scheduleType: data.scheduleType }, 'IPC: 定时任务已创建')
    },
    onPauseTask: (taskId) => {
      const task = getTask(taskId)
      if (task) {
        updateTask(taskId, { status: 'paused' })
        refreshTasksSnapshot(task.agent_id)
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
        refreshTasksSnapshot(task.agent_id)
        logger.info({ taskId }, 'IPC: 定时任务已恢复')
      } else {
        logger.warn({ taskId }, 'IPC: 恢复失败，任务不存在')
      }
    },
    onCancelTask: (taskId) => {
      const task = getTask(taskId)
      if (task) {
        deleteTask(taskId)
        refreshTasksSnapshot(task.agent_id)
        logger.info({ taskId }, 'IPC: 定时任务已取消')
      } else {
        logger.warn({ taskId }, 'IPC: 取消失败，任务不存在')
      }
    },
  })
  ipcWatcher.start()
  logger.info('IPC Watcher 已启动')

  /** 刷新指定 agent 的任务快照 */
  function refreshTasksSnapshot(agentId: string) {
    const allTasks = getTasks()
    const agentTasks = allTasks
      .filter((t) => t.agent_id === agentId)
      .map((t) => ({
        id: t.id,
        prompt: t.prompt,
        schedule_type: t.schedule_type,
        schedule_value: t.schedule_value,
        status: t.status,
        next_run: t.next_run,
        last_run: t.last_run,
      }))
    writeTasksSnapshot(agentId, agentTasks)
  }

  // 13. 创建 HTTP 服务
  const app = createApp({ agentManager, agentQueue, eventBus, router, skillsLoader, memoryManager, scheduler })

  const server = Bun.serve({
    port: env.PORT,
    fetch: app.fetch,
  })

  logger.info({ port: env.PORT }, `HTTP 服务已启动: http://localhost:${env.PORT}`)
  logger.info('YouClaw 已就绪')

  // 14. 优雅关闭
  const shutdown = () => {
    logger.info('正在关闭...')
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
