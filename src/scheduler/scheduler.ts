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
import type { ScheduledTask } from '../db/index.ts'
import type { AgentQueue } from '../agent/queue.ts'
import type { AgentManager } from '../agent/manager.ts'
import type { EventBus } from '../events/index.ts'

// 退避延迟梯度（毫秒）：30s, 1m, 5m, 15m, 60m
const BACKOFF_DELAYS = [30_000, 60_000, 300_000, 900_000, 3_600_000]
// 连续失败 N 次后自动暂停
const MAX_CONSECUTIVE_FAILURES = 5
// 卡住检测阈值（5 分钟）
const STUCK_THRESHOLD_MS = 5 * 60 * 1000
// 日志裁剪间隔（每 120 次 tick，约 1 小时）
const PRUNE_INTERVAL_TICKS = 120
// 日志保留天数
const LOG_RETAIN_DAYS = 30

export class Scheduler {
  private intervalId: Timer | null = null
  private tickCount = 0

  constructor(
    private agentQueue: AgentQueue,
    private agentManager: AgentManager,
    private eventBus: EventBus,
  ) {}

  /** 启动调度循环（每 30 秒检查一次） */
  start(): void {
    const logger = getLogger()
    if (this.intervalId) return

    logger.info('Scheduler 已启动，每 30 秒检查一次')
    // 立即执行一次
    this.tick().catch((err) => {
      logger.error({ error: String(err) }, 'Scheduler tick 失败')
    })

    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ error: String(err) }, 'Scheduler tick 失败')
      })
    }, 30_000)
  }

  /** 停止调度 */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      getLogger().info('Scheduler 已停止')
    }
  }

  /** 检查并执行到期任务 */
  private async tick(): Promise<void> {
    const logger = getLogger()

    // 卡住检测：重置超时任务的 running_since
    this.recoverStuckTasks()

    const now = new Date().toISOString()
    const dueTasks = getTasksDueBy(now)

    for (const task of dueTasks) {
      // 先同步锁定任务，防止下次 tick 重复取出（竞态条件修复）
      updateTask(task.id, { runningSince: now })

      // 不 await：并行执行多个到期任务
      this.executeTask(task).catch((err) => {
        logger.error({ taskId: task.id, error: String(err) }, '执行定时任务失败')
      })
    }

    // 定期裁剪旧日志
    this.tickCount++
    if (this.tickCount >= PRUNE_INTERVAL_TICKS) {
      this.tickCount = 0
      try {
        const deleted = pruneOldTaskRunLogs(LOG_RETAIN_DAYS)
        if (deleted > 0) {
          logger.info({ deleted }, '已裁剪过期运行日志')
        }
      } catch (err) {
        logger.error({ error: String(err) }, '裁剪运行日志失败')
      }
    }
  }

  /** 检测并恢复卡住的任务 */
  private recoverStuckTasks(): void {
    const logger = getLogger()
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString()
    const stuckTasks = getStuckTasks(cutoff)

    for (const task of stuckTasks) {
      const newFailures = (task.consecutive_failures ?? 0) + 1
      logger.warn(
        { taskId: task.id, runningSince: task.running_since, consecutiveFailures: newFailures },
        '检测到卡住任务，重置 running_since'
      )

      saveTaskRunLog({
        taskId: task.id,
        runAt: task.running_since!,
        durationMs: Date.now() - new Date(task.running_since!).getTime(),
        status: 'error',
        error: `任务执行超时（超过 ${STUCK_THRESHOLD_MS / 1000} 秒）`,
      })

      if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
        // 连续失败过多，自动暂停（传入 consecutiveFailures 以正确计算退避后的 nextRun）
        const nextRun = this.calculateNextRun(task, { consecutiveFailures: newFailures })
        updateTask(task.id, {
          runningSince: null,
          consecutiveFailures: newFailures,
          status: 'paused',
          lastResult: `ERROR: 连续失败 ${newFailures} 次，自动暂停`,
          nextRun,
        })
        logger.warn({ taskId: task.id, consecutiveFailures: newFailures }, '任务连续失败过多，已自动暂停')
      } else {
        // 计算退避后的下次运行时间
        const nextRun = this.calculateNextRun(task, { consecutiveFailures: newFailures })
        updateTask(task.id, {
          runningSince: null,
          consecutiveFailures: newFailures,
          lastResult: `ERROR: 任务执行超时`,
          nextRun,
        })
      }
    }
  }

  /** 执行单个任务 */
  async executeTask(task: ScheduledTask): Promise<void> {
    const logger = getLogger()
    const runAt = new Date().toISOString()
    const startMs = Date.now()

    logger.info({ taskId: task.id, agentId: task.agent_id }, '执行定时任务')

    // running_since 已在 tick() 中同步设置，此处不再重复

    try {
      const result = await this.agentQueue.enqueue(task.agent_id, task.chat_id, task.prompt)
      const durationMs = Date.now() - startMs

      saveTaskRunLog({
        taskId: task.id,
        runAt,
        durationMs,
        status: 'success',
        result,
      })

      // 保存执行结果到 messages 表，使 Chat 页面可见
      this.saveTaskMessages(task, runAt, result ?? '(no output)')

      // 通过 EventBus 推送结果到 channel（Telegram/Web 等）
      this.eventBus.emit({
        type: 'complete',
        agentId: task.agent_id,
        chatId: task.chat_id,
        fullText: result ?? '(no output)',
        sessionId: `task:${task.id}`,
      })

      // 计算下次运行时间（成功时重置退避）
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
        // once 类型任务执行后标记为 completed
        updateTask(task.id, {
          lastRun: runAt,
          nextRun: null,
          status: 'completed',
          runningSince: null,
          consecutiveFailures: 0,
          lastResult: result?.slice(0, 500) ?? null,
        })
      }

      logger.info({ taskId: task.id, durationMs }, '定时任务执行成功')
    } catch (err) {
      const durationMs = Date.now() - startMs
      const errorMsg = err instanceof Error ? err.message : String(err)

      saveTaskRunLog({
        taskId: task.id,
        runAt,
        durationMs,
        status: 'error',
        error: errorMsg,
      })

      const newFailures = (task.consecutive_failures ?? 0) + 1

      if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
        // 连续失败过多，自动暂停（传入 consecutiveFailures 以正确计算退避后的 nextRun）
        const nextRun = this.calculateNextRun(task, { consecutiveFailures: newFailures })
        updateTask(task.id, {
          lastRun: runAt,
          nextRun,
          runningSince: null,
          consecutiveFailures: newFailures,
          status: 'paused',
          lastResult: `ERROR: ${errorMsg}`.slice(0, 500),
        })
        logger.warn({ taskId: task.id, consecutiveFailures: newFailures }, '任务连续失败过多，已自动暂停')
      } else {
        // 计算退避后的下次运行时间
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

      logger.error({ taskId: task.id, error: errorMsg, consecutiveFailures: newFailures }, '定时任务执行失败')
    }
  }

  /** 保存任务执行消息到 messages 表 */
  saveTaskMessages(
    task: Pick<ScheduledTask, 'id' | 'chat_id' | 'agent_id' | 'prompt' | 'name'>,
    runAt: string,
    result: string,
    sender = 'scheduler',
    senderName = 'Scheduled Task',
  ): void {
    const timestamp = new Date().toISOString()

    // 保存用户 prompt 消息（isFromMe=false 表示非 bot 发出，与 router 语义一致）
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

    // 保存 bot 结果消息（isFromMe=true 表示 bot 发出）
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

    // 更新 chat 记录
    const taskName = task.name || task.prompt.slice(0, 30)
    upsertChat(task.chat_id, task.agent_id, `Task: ${taskName}`, 'task')
  }

  /** 手动执行任务（不设 running_since，不影响 consecutiveFailures） */
  async runManually(task: ScheduledTask): Promise<{ status: string; result?: string; error?: string }> {
    const runAt = new Date().toISOString()
    const startMs = Date.now()
    const runId = crypto.randomUUID().slice(0, 8)

    try {
      const result = await this.agentQueue.enqueue(task.agent_id, task.chat_id, task.prompt)
      const durationMs = Date.now() - startMs

      // 记录运行日志
      saveTaskRunLog({
        taskId: task.id,
        runAt,
        durationMs,
        status: 'success',
        result: `[manual] ${result ?? ''}`.slice(0, 500),
      })

      // 保存执行结果到 messages 表
      this.saveTaskMessages(task, `${runId}-${runAt}`, result ?? '(no output)', 'manual', 'Manual Run')

      return { status: 'success', result: result ?? undefined }
    } catch (err) {
      const durationMs = Date.now() - startMs
      const error = err instanceof Error ? err.message : String(err)

      // 记录失败日志
      saveTaskRunLog({
        taskId: task.id,
        runAt,
        durationMs,
        status: 'error',
        error: `[manual] ${error}`,
      })

      return { status: 'error', error }
    }
  }

  /** 计算下次运行时间 */
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
        // once 成功后返回 null（标记 completed）；失败时由退避逻辑计算重试时间
        if (!options?.consecutiveFailures) return null
        // 有失败，需要退避重试：以当前时间为基准计算退避
        nextTime = now
        break
      }
      default:
        return null
    }

    if (!nextTime) return null

    // 退避逻辑：有连续失败时延后下次运行
    const failures = options?.consecutiveFailures ?? 0
    if (failures > 0) {
      const backoffIdx = Math.min(failures - 1, BACKOFF_DELAYS.length - 1)
      const backoffMs = BACKOFF_DELAYS[backoffIdx]!
      const backoffTime = new Date(now.getTime() + backoffMs)
      // 取 max(正常下次时间, now + backoffDelay)
      if (backoffTime.getTime() > nextTime.getTime()) {
        nextTime = backoffTime
      }
    }

    return nextTime.toISOString()
  }
}
