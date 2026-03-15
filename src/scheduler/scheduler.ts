import { Cron } from 'croner'
import { getLogger } from '../logger/index.ts'
import {
  getTasksDueBy,
  getStuckTasks,
  updateTask,
  saveTaskRunLog,
  saveMessage,
  upsertChat,
  pruneOldTaskRunLogs,
} from '../db/index.ts'
import { cleanOldLogs } from '../logger/reader.ts'
import type { ScheduledTask } from '../db/index.ts'
import type { AgentQueue } from '../agent/queue.ts'
import type { AgentManager } from '../agent/manager.ts'
import type { EventBus } from '../events/index.ts'

// Backoff delay tiers (ms): 30s, 1m, 5m, 15m, 60m
const BACKOFF_DELAYS = [30_000, 60_000, 300_000, 900_000, 3_600_000]
// Auto-pause after N consecutive failures
const MAX_CONSECUTIVE_FAILURES = 5
// Stuck detection threshold (5 minutes)
const STUCK_THRESHOLD_MS = 5 * 60 * 1000
// Log pruning interval (every 120 ticks, ~1 hour)
const PRUNE_INTERVAL_TICKS = 120
// Log retention days
const LOG_RETAIN_DAYS = 30

export class Scheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private tickCount = 0

  constructor(
    private agentQueue: AgentQueue,
    private agentManager: AgentManager,
    private eventBus: EventBus,
  ) {}

  /** Start scheduling loop (check every 30 seconds) */
  start(): void {
    const logger = getLogger()
    if (this.intervalId) return

    logger.info('Scheduler started, checking every 30 seconds')
    // Execute immediately
    this.tick().catch((err) => {
      logger.error({ error: String(err) }, 'Scheduler tick failed')
    })

    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ error: String(err) }, 'Scheduler tick failed')
      })
    }, 30_000)
  }

  /** Stop scheduling */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      getLogger().info('Scheduler stopped')
    }
  }

  /** Check and execute due tasks */
  private async tick(): Promise<void> {
    const logger = getLogger()

    // Stuck detection: reset timed-out task running_since
    this.recoverStuckTasks()

    const now = new Date().toISOString()
    const dueTasks = getTasksDueBy(now)

    for (const task of dueTasks) {
      // Lock task synchronously to prevent duplicate pickup on next tick (race condition fix)
      updateTask(task.id, { runningSince: now })

      // No await: execute multiple due tasks in parallel
      this.executeTask(task).catch((err) => {
        logger.error({ taskId: task.id, error: String(err), category: 'task' }, 'Scheduled task execution failed')
      })
    }

    // Periodically prune old logs
    this.tickCount++
    if (this.tickCount >= PRUNE_INTERVAL_TICKS) {
      this.tickCount = 0
      try {
        const deleted = pruneOldTaskRunLogs(LOG_RETAIN_DAYS)
        if (deleted > 0) {
          logger.info({ deleted }, 'Pruned expired run logs')
        }
        // Clean expired system log files
        const deletedLogs = cleanOldLogs(LOG_RETAIN_DAYS)
        if (deletedLogs > 0) {
          logger.info({ deleted: deletedLogs }, 'Cleaned expired system log files')
        }
      } catch (err) {
        logger.error({ error: String(err) }, 'Failed to prune run logs')
      }
    }
  }

  /** Detect and recover stuck tasks */
  private recoverStuckTasks(): void {
    const logger = getLogger()
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString()
    const stuckTasks = getStuckTasks(cutoff)

    for (const task of stuckTasks) {
      const newFailures = (task.consecutive_failures ?? 0) + 1
      logger.warn(
        { taskId: task.id, runningSince: task.running_since, consecutiveFailures: newFailures, category: 'task' },
        'Stuck task detected, resetting running_since'
      )

      saveTaskRunLog({
        taskId: task.id,
        runAt: task.running_since!,
        durationMs: Date.now() - new Date(task.running_since!).getTime(),
        status: 'error',
        error: `Task execution timed out (exceeded ${STUCK_THRESHOLD_MS / 1000}s)`,
      })

      if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Too many consecutive failures, auto-pause (pass consecutiveFailures for correct backoff nextRun)
        const nextRun = this.calculateNextRun(task, { consecutiveFailures: newFailures })
        updateTask(task.id, {
          runningSince: null,
          consecutiveFailures: newFailures,
          status: 'paused',
          lastResult: `ERROR: ${newFailures} consecutive failures, auto-paused`,
          nextRun,
        })
        logger.warn({ taskId: task.id, consecutiveFailures: newFailures, category: 'task' }, 'Too many consecutive failures, task auto-paused')
      } else {
        // Calculate next run time with backoff
        const nextRun = this.calculateNextRun(task, { consecutiveFailures: newFailures })
        updateTask(task.id, {
          runningSince: null,
          consecutiveFailures: newFailures,
          lastResult: `ERROR: Task execution timed out`,
          nextRun,
        })
      }
    }
  }

  /** Execute a single task */
  async executeTask(task: ScheduledTask): Promise<void> {
    const logger = getLogger()
    const runAt = new Date().toISOString()
    const startMs = Date.now()

    logger.info({ taskId: task.id, agentId: task.agent_id, taskName: task.name, category: 'task' }, 'Executing scheduled task')

    // running_since already set synchronously in tick(), no need to repeat

    try {
      const result = await this.agentQueue.enqueue(task.agent_id, task.chat_id, task.prompt)
      const durationMs = Date.now() - startMs

      // Save execution result to messages table for Chat page visibility
      this.saveTaskMessages(task, runAt, result ?? '(no output)')

      // Deliver to external channel (best-effort)
      const deliveryStatus = this.deliver(task, result ?? '(no output)')

      saveTaskRunLog({
        taskId: task.id,
        runAt,
        durationMs,
        status: 'success',
        result,
        deliveryStatus,
      })

      // Calculate next run time (reset backoff on success)
      const nextRun = this.calculateNextRun(task)
      if (nextRun) {
        updateTask(task.id, {
          lastRun: runAt,
          nextRun,
          runningSince: null,
          consecutiveFailures: 0,
          lastResult: result?.slice(0, 500) ?? null,
        })
      } else {
        // Mark once-type tasks as completed after execution
        updateTask(task.id, {
          lastRun: runAt,
          nextRun: null,
          status: 'completed',
          runningSince: null,
          consecutiveFailures: 0,
          lastResult: result?.slice(0, 500) ?? null,
        })
      }

      logger.info({ taskId: task.id, agentId: task.agent_id, durationMs, category: 'task' }, 'Scheduled task executed successfully')
    } catch (err) {
      const durationMs = Date.now() - startMs
      const errorMsg = err instanceof Error ? err.message : String(err)

      saveTaskRunLog({
        taskId: task.id,
        runAt,
        durationMs,
        status: 'error',
        error: errorMsg,
        deliveryStatus: 'skipped',
      })

      const newFailures = (task.consecutive_failures ?? 0) + 1

      if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Too many consecutive failures, auto-pause (pass consecutiveFailures for correct backoff nextRun)
        const nextRun = this.calculateNextRun(task, { consecutiveFailures: newFailures })
        updateTask(task.id, {
          lastRun: runAt,
          nextRun,
          runningSince: null,
          consecutiveFailures: newFailures,
          status: 'paused',
          lastResult: `ERROR: ${errorMsg}`.slice(0, 500),
        })
        logger.warn({ taskId: task.id, consecutiveFailures: newFailures, category: 'task' }, 'Too many consecutive failures, task auto-paused')
      } else {
        // Calculate next run time with backoff
        const nextRun = this.calculateNextRun(task, { consecutiveFailures: newFailures })
        if (nextRun) {
          updateTask(task.id, {
            lastRun: runAt,
            nextRun,
            runningSince: null,
            consecutiveFailures: newFailures,
            lastResult: `ERROR: ${errorMsg}`.slice(0, 500),
          })
        } else {
          updateTask(task.id, {
            lastRun: runAt,
            nextRun: null,
            status: 'completed',
            runningSince: null,
            consecutiveFailures: newFailures,
            lastResult: `ERROR: ${errorMsg}`.slice(0, 500),
          })
        }
      }

      logger.error({ taskId: task.id, agentId: task.agent_id, error: errorMsg, consecutiveFailures: newFailures, category: 'task' }, 'Scheduled task execution failed')
    }
  }

  /** Save task execution messages to messages table */
  /** Deliver result to external channel (best-effort, failure does not affect task status) */
  private deliver(
    task: Pick<ScheduledTask, 'id' | 'agent_id' | 'name' | 'prompt' | 'delivery_mode' | 'delivery_target'>,
    text: string,
  ): 'sent' | 'failed' | 'skipped' {
    if (task.delivery_mode !== 'push' || !task.delivery_target) {
      return 'skipped'
    }

    const logger = getLogger()
    try {
      const taskName = task.name || task.prompt.slice(0, 30)
      this.eventBus.emit({
        type: 'complete',
        agentId: task.agent_id,
        chatId: task.delivery_target,
        fullText: `[Task: ${taskName}]\n\n${text}`,
        sessionId: `task:${task.id}`,
      })
      logger.info({ taskId: task.id, deliveryTarget: task.delivery_target }, 'Task result delivered')
      return 'sent'
    } catch (err) {
      logger.warn({ taskId: task.id, deliveryTarget: task.delivery_target, error: String(err) }, 'Delivery failed (best-effort)')
      return 'failed'
    }
  }

  saveTaskMessages(
    task: Pick<ScheduledTask, 'id' | 'chat_id' | 'agent_id' | 'prompt' | 'name'>,
    runAt: string,
    result: string,
    sender = 'scheduler',
    senderName = 'Scheduled Task',
  ): void {
    const timestamp = new Date().toISOString()

    // Save user prompt message (isFromMe=false means not sent by bot, consistent with router semantics)
    saveMessage({
      id: `${task.id}-${runAt}-user`,
      chatId: task.chat_id,
      sender,
      senderName,
      content: task.prompt,
      timestamp: runAt,
      isFromMe: false,
      isBotMessage: false,
    })

    // Save bot result message (isFromMe=true means sent by bot)
    saveMessage({
      id: `${task.id}-${runAt}-bot`,
      chatId: task.chat_id,
      sender: task.agent_id,
      senderName: task.agent_id,
      content: result,
      timestamp,
      isFromMe: true,
      isBotMessage: true,
    })

    // Update chat record
    const taskName = task.name || task.prompt.slice(0, 30)
    upsertChat(task.chat_id, task.agent_id, `Task: ${taskName}`, 'task')
  }

  /** Manually execute task (no running_since, does not affect consecutiveFailures) */
  async runManually(task: ScheduledTask): Promise<{ status: string; result?: string; error?: string }> {
    const runAt = new Date().toISOString()
    const startMs = Date.now()
    const runId = crypto.randomUUID().slice(0, 8)

    try {
      const result = await this.agentQueue.enqueue(task.agent_id, task.chat_id, task.prompt)
      const durationMs = Date.now() - startMs

      // Save execution result to messages table
      this.saveTaskMessages(task, `${runId}-${runAt}`, result ?? '(no output)', 'manual', 'Manual Run')

      // Deliver to external channel
      const deliveryStatus = this.deliver(task, result ?? '(no output)')

      // Record run log
      saveTaskRunLog({
        taskId: task.id,
        runAt,
        durationMs,
        status: 'success',
        result: `[manual] ${result ?? ''}`.slice(0, 500),
        deliveryStatus,
      })

      return { status: 'success', result: result ?? undefined }
    } catch (err) {
      const durationMs = Date.now() - startMs
      const error = err instanceof Error ? err.message : String(err)

      // Record failure log
      saveTaskRunLog({
        taskId: task.id,
        runAt,
        durationMs,
        status: 'error',
        error: `[manual] ${error}`,
        deliveryStatus: 'skipped',
      })

      return { status: 'error', error }
    }
  }

  /** Calculate next run time */
  calculateNextRun(
    task: Pick<ScheduledTask, 'schedule_type' | 'schedule_value' | 'last_run'> & { timezone?: string | null },
    options?: { consecutiveFailures?: number },
  ): string | null {
    const now = new Date()
    let nextTime: Date | null = null

    switch (task.schedule_type) {
      case 'cron': {
        const cronOpts: { timezone?: string } = {}
        if (task.timezone) cronOpts.timezone = task.timezone
        const job = new Cron(task.schedule_value, cronOpts)
        const next = job.nextRun()
        nextTime = next
        break
      }
      case 'interval': {
        const intervalMs = parseInt(task.schedule_value, 10)
        if (isNaN(intervalMs) || intervalMs <= 0) return null
        const base = task.last_run ? new Date(task.last_run) : now
        nextTime = new Date(base.getTime() + intervalMs)
        break
      }
      case 'once': {
        // Return null after once succeeds (marks completed); on failure, backoff logic calculates retry time
        if (!options?.consecutiveFailures) return null
        // Has failures, need backoff retry: calculate backoff based on current time
        nextTime = now
        break
      }
      default:
        return null
    }

    if (!nextTime) return null

    // Backoff logic: delay next run on consecutive failures
    const failures = options?.consecutiveFailures ?? 0
    if (failures > 0) {
      const backoffIdx = Math.min(failures - 1, BACKOFF_DELAYS.length - 1)
      const backoffMs = BACKOFF_DELAYS[backoffIdx]!
      const backoffTime = new Date(now.getTime() + backoffMs)
      // Take max(normal next time, now + backoffDelay)
      if (backoffTime.getTime() > nextTime.getTime()) {
        nextTime = backoffTime
      }
    }

    return nextTime.toISOString()
  }
}
