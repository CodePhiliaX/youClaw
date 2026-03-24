import { readdirSync, unlinkSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { getLogger } from '../logger/index.ts'
import { getPaths } from '../config/index.ts'

// ===== IPC File Message Types =====

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

// ===== Dependency Interface =====

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

  /** Start IPC file polling (every 3 seconds) */
  start(): void {
    const logger = getLogger()
    if (this.intervalId) return

    // Ensure IPC root directory exists
    mkdirSync(this.ipcDir, { recursive: true })

    logger.info({ ipcDir: this.ipcDir }, 'IPC Watcher started, polling every 3 seconds')

    // Execute immediately
    this.tick().catch((err) => {
      logger.error({ error: String(err) }, 'IPC tick failed')
    })

    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ error: String(err) }, 'IPC tick failed')
      })
    }, 3_000)
  }

  /** Stop polling */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      getLogger().info('IPC Watcher stopped')
    }
  }

  /** Scan all agent IPC directories and process JSON files */
  private async tick(): Promise<void> {
    if (!existsSync(this.ipcDir)) return

    // Scan all agent directories under data/ipc/
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
          .sort() // Sort by filename (timestamp prefix ensures order)
      } catch {
        continue
      }

      for (const file of files) {
        const filePath = join(tasksDir, file)
        await this.processFile(filePath, agentId)
      }
    }
  }

  /** Process a single IPC JSON file */
  private async processFile(filePath: string, agentId: string): Promise<void> {
    const logger = getLogger()

    let raw: string
    try {
      raw = readFileSync(filePath, 'utf-8')
    } catch (err) {
      logger.warn({ filePath, error: String(err) }, 'IPC file read failed')
      this.moveToErrors(filePath, `read_error: ${String(err)}`)
      return
    }

    let message: IpcMessage
    try {
      message = JSON.parse(raw) as IpcMessage
    } catch (err) {
      logger.warn({ filePath, error: String(err) }, 'IPC file JSON parse failed')
      this.moveToErrors(filePath, `parse_error: ${String(err)}`)
      return
    }

    try {
      this.dispatch(message, agentId)
      // Successfully processed, delete file
      unlinkSync(filePath)
      logger.info({ filePath, type: message.type, agentId }, 'IPC message processed')
    } catch (err) {
      logger.error({ filePath, type: message.type, error: String(err) }, 'IPC message processing failed')
      this.moveToErrors(filePath, `dispatch_error: ${String(err)}`)
    }
  }

  /** Dispatch to the appropriate callback based on message type */
  private dispatch(message: IpcMessage, agentId: string): void {
    switch (message.type) {
      case 'schedule_task': {
        if (!message.prompt || !message.schedule_type || !message.schedule_value || !message.chatId) {
          throw new Error('schedule_task missing required fields: prompt, schedule_type, schedule_value, chatId')
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
          throw new Error('pause_task missing required field: taskId')
        }
        this.deps.onPauseTask(message.taskId)
        break
      }
      case 'resume_task': {
        if (!message.taskId) {
          throw new Error('resume_task missing required field: taskId')
        }
        this.deps.onResumeTask(message.taskId)
        break
      }
      case 'cancel_task': {
        if (!message.taskId) {
          throw new Error('cancel_task missing required field: taskId')
        }
        this.deps.onCancelTask(message.taskId)
        break
      }
      default: {
        throw new Error(`Unknown IPC message type: ${(message as { type: string }).type}`)
      }
    }
  }

  /** Move failed files to the errors directory */
  private moveToErrors(filePath: string, reason: string): void {
    const logger = getLogger()
    const errorsDir = resolve(this.ipcDir, 'errors')

    try {
      mkdirSync(errorsDir, { recursive: true })

      const fileName = filePath.split('/').pop() ?? 'unknown.json'
      const errorPath = join(errorsDir, `${Date.now()}-${fileName}`)

      // Read original file content and write it with error info to the errors directory
      let content = ''
      try {
        content = readFileSync(filePath, 'utf-8')
      } catch {
        content = '(unable to read original file)'
      }

      const errorContent = JSON.stringify({ _error: reason, _originalFile: fileName, _content: content }, null, 2)
      writeFileSync(errorPath, errorContent)

      // Delete original file
      try {
        unlinkSync(filePath)
      } catch {
        // Ignore deletion failure (file may already be deleted)
      }

      logger.info({ errorPath, reason }, 'IPC error file saved')
    } catch (err) {
      logger.error({ filePath, error: String(err) }, 'Failed to move IPC error file, deleting directly')
      try {
        unlinkSync(filePath)
      } catch {
        // ignore
      }
    }
  }
}
