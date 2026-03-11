import { readdirSync, unlinkSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { getLogger } from '../logger/index.ts'
import { getPaths } from '../config/index.ts'

// ===== IPC 文件消息类型 =====

interface ScheduleTaskMessage {
  type: 'schedule_task'
  prompt: string
  schedule_type: string
  schedule_value: string
  chatId: string
  name?: string
  description?: string
  timezone?: string
  delivery_mode?: string
  delivery_target?: string
}

interface PauseTaskMessage {
  type: 'pause_task'
  taskId: string
}

interface ResumeTaskMessage {
  type: 'resume_task'
  taskId: string
}

interface CancelTaskMessage {
  type: 'cancel_task'
  taskId: string
}

type IpcMessage = ScheduleTaskMessage | PauseTaskMessage | ResumeTaskMessage | CancelTaskMessage

// ===== 依赖接口 =====

export interface IpcDeps {
  onScheduleTask: (data: {
    prompt: string
    scheduleType: string
    scheduleValue: string
    agentId: string
    chatId: string
    name?: string
    description?: string
    timezone?: string
    deliveryMode?: string
    deliveryTarget?: string
  }) => void
  onPauseTask: (taskId: string) => void
  onResumeTask: (taskId: string) => void
  onCancelTask: (taskId: string) => void
}

// ===== IPC Watcher =====

export class IpcWatcher {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private ipcDir: string

  constructor(private deps: IpcDeps) {
    const paths = getPaths()
    this.ipcDir = resolve(paths.data, 'ipc')
  }

  /** 启动 IPC 文件轮询（每 3 秒） */
  start(): void {
    const logger = getLogger()
    if (this.intervalId) return

    // 确保 IPC 根目录存在
    mkdirSync(this.ipcDir, { recursive: true })

    logger.info({ ipcDir: this.ipcDir }, 'IPC Watcher 已启动，每 3 秒轮询')

    // 立即执行一次
    this.tick().catch((err) => {
      logger.error({ error: String(err) }, 'IPC tick 失败')
    })

    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ error: String(err) }, 'IPC tick 失败')
      })
    }, 3_000)
  }

  /** 停止轮询 */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      getLogger().info('IPC Watcher 已停止')
    }
  }

  /** 扫描所有 agent 的 IPC 目录，处理 JSON 文件 */
  private async tick(): Promise<void> {
    if (!existsSync(this.ipcDir)) return

    // 扫描 data/ipc/ 下的所有 agent 目录
    let agentDirs: string[]
    try {
      agentDirs = readdirSync(this.ipcDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return
    }

    for (const agentId of agentDirs) {
      const tasksDir = join(this.ipcDir, agentId, 'tasks')
      if (!existsSync(tasksDir)) continue

      let files: string[]
      try {
        files = readdirSync(tasksDir)
          .filter((f) => f.endsWith('.json'))
          .sort() // 按文件名排序（时间戳前缀保证顺序）
      } catch {
        continue
      }

      for (const file of files) {
        const filePath = join(tasksDir, file)
        await this.processFile(filePath, agentId)
      }
    }
  }

  /** 处理单个 IPC JSON 文件 */
  private async processFile(filePath: string, agentId: string): Promise<void> {
    const logger = getLogger()

    let raw: string
    try {
      raw = readFileSync(filePath, 'utf-8')
    } catch (err) {
      logger.warn({ filePath, error: String(err) }, 'IPC 文件读取失败')
      this.moveToErrors(filePath, `read_error: ${String(err)}`)
      return
    }

    let message: IpcMessage
    try {
      message = JSON.parse(raw) as IpcMessage
    } catch (err) {
      logger.warn({ filePath, error: String(err) }, 'IPC 文件 JSON 解析失败')
      this.moveToErrors(filePath, `parse_error: ${String(err)}`)
      return
    }

    try {
      this.dispatch(message, agentId)
      // 处理成功，删除文件
      unlinkSync(filePath)
      logger.info({ filePath, type: message.type, agentId }, 'IPC 消息已处理')
    } catch (err) {
      logger.error({ filePath, type: message.type, error: String(err) }, 'IPC 消息处理失败')
      this.moveToErrors(filePath, `dispatch_error: ${String(err)}`)
    }
  }

  /** 根据消息类型分发到对应的回调 */
  private dispatch(message: IpcMessage, agentId: string): void {
    switch (message.type) {
      case 'schedule_task': {
        if (!message.prompt || !message.schedule_type || !message.schedule_value || !message.chatId) {
          throw new Error('schedule_task 缺少必要字段: prompt, schedule_type, schedule_value, chatId')
        }
        this.deps.onScheduleTask({
          prompt: message.prompt,
          scheduleType: message.schedule_type,
          scheduleValue: message.schedule_value,
          agentId,
          chatId: message.chatId,
          name: message.name,
          description: message.description,
          timezone: message.timezone,
          deliveryMode: message.delivery_mode,
          deliveryTarget: message.delivery_target,
        })
        break
      }
      case 'pause_task': {
        if (!message.taskId) {
          throw new Error('pause_task 缺少必要字段: taskId')
        }
        this.deps.onPauseTask(message.taskId)
        break
      }
      case 'resume_task': {
        if (!message.taskId) {
          throw new Error('resume_task 缺少必要字段: taskId')
        }
        this.deps.onResumeTask(message.taskId)
        break
      }
      case 'cancel_task': {
        if (!message.taskId) {
          throw new Error('cancel_task 缺少必要字段: taskId')
        }
        this.deps.onCancelTask(message.taskId)
        break
      }
      default: {
        throw new Error(`未知 IPC 消息类型: ${(message as { type: string }).type}`)
      }
    }
  }

  /** 将处理失败的文件移到 errors 目录 */
  private moveToErrors(filePath: string, reason: string): void {
    const logger = getLogger()
    const errorsDir = resolve(this.ipcDir, 'errors')

    try {
      mkdirSync(errorsDir, { recursive: true })

      const fileName = filePath.split('/').pop() ?? 'unknown.json'
      const errorPath = join(errorsDir, `${Date.now()}-${fileName}`)

      // 读取原文件内容，加上错误信息一起写入 errors 目录
      let content = ''
      try {
        content = readFileSync(filePath, 'utf-8')
      } catch {
        content = '(unable to read original file)'
      }

      const errorContent = JSON.stringify({ _error: reason, _originalFile: fileName, _content: content }, null, 2)
      writeFileSync(errorPath, errorContent)

      // 删除原文件
      try {
        unlinkSync(filePath)
      } catch {
        // 如果删除失败，忽略（可能已被删除）
      }

      logger.info({ errorPath, reason }, 'IPC 错误文件已保存')
    } catch (err) {
      logger.error({ filePath, error: String(err) }, '移动 IPC 错误文件失败，直接删除')
      try {
        unlinkSync(filePath)
      } catch {
        // 忽略
      }
    }
  }
}

// ===== 任务快照写入 =====

/** 将指定 agent 的当前任务列表写入 current_tasks.json */
export function writeTasksSnapshot(agentId: string, tasks: Array<{
  id: string
  prompt: string
  schedule_type: string
  schedule_value: string
  status: string
  next_run: string | null
  last_run: string | null
}>): void {
  const paths = getPaths()
  const agentIpcDir = resolve(paths.data, 'ipc', agentId)
  mkdirSync(agentIpcDir, { recursive: true })

  const snapshotPath = join(agentIpcDir, 'current_tasks.json')
  const snapshot = {
    updatedAt: new Date().toISOString(),
    tasks,
  }

  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
}
