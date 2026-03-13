import { getLogger } from '../logger/index.ts'
import type { AgentManager } from './manager.ts'

interface QueueItem {
  agentId: string
  chatId: string
  prompt: string
  requestedSkills?: string[]
  browserProfileId?: string
  attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>
  resolve: (result: string) => void
  reject: (error: Error) => void
}

/**
 * 双层队列
 * 外层：按 agentId 控制并发数（maxConcurrency）
 * 内层：按 agentId:chatId 保证同一对话有序
 * 同一 agent 不同 chat 可并发
 */
export class AgentQueue {
  // 内层：每个 chat 的有序队列
  private chatQueues: Map<string, QueueItem[]> = new Map()    // `${agentId}:${chatId}` -> 队列
  private chatRunning: Set<string> = new Set()                 // 正在运行的 chatKey

  // 外层：每个 agent 的并发控制
  private agentRunning: Map<string, number> = new Map()        // agentId -> 当前运行数
  private agentManager: AgentManager

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager
  }

  /**
   * 入队消息，返回 agent 回复
   */
  async enqueue(agentId: string, chatId: string, prompt: string, requestedSkills?: string[], browserProfileId?: string, attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chatKey = `${agentId}:${chatId}`
      const queue = this.chatQueues.get(chatKey) ?? []
      queue.push({ agentId, chatId, prompt, requestedSkills, browserProfileId, attachments, resolve, reject })
      this.chatQueues.set(chatKey, queue)

      // 更新 agent state 的 queueDepth
      this.updateQueueDepth(agentId)

      // 尝试调度
      this.trySchedule(agentId, chatKey)
    })
  }

  /**
   * 获取指定 agent 的总排队深度
   */
  getQueueDepth(agentId: string): number {
    let depth = 0
    for (const [key, queue] of this.chatQueues) {
      if (key.startsWith(`${agentId}:`)) {
        depth += queue.length
      }
    }
    return depth
  }

  /**
   * 尝试调度指定 chat 的下一个任务
   */
  private trySchedule(agentId: string, chatKey: string): void {
    // 如果此 chat 已在运行，等待完成后自动调度
    if (this.chatRunning.has(chatKey)) return

    // 检查 agent 并发限制
    const managed = this.agentManager.getAgent(agentId)
    const maxConcurrency = managed?.config.maxConcurrency ?? 1
    const currentRunning = this.agentRunning.get(agentId) ?? 0

    if (currentRunning >= maxConcurrency) return

    // 从队列取出下一个任务
    const queue = this.chatQueues.get(chatKey)
    if (!queue || queue.length === 0) return

    const item = queue.shift()!
    this.chatRunning.add(chatKey)
    this.agentRunning.set(agentId, currentRunning + 1)
    this.updateQueueDepth(agentId)

    // 异步执行
    this.processItem(item, chatKey).finally(() => {
      this.chatRunning.delete(chatKey)
      const running = this.agentRunning.get(agentId) ?? 1
      this.agentRunning.set(agentId, Math.max(0, running - 1))
      this.updateQueueDepth(agentId)

      // 继续调度此 chat 的下一个任务
      this.trySchedule(agentId, chatKey)

      // 尝试调度同 agent 其他 chat 的任务
      this.tryScheduleAgent(agentId)
    })
  }

  /**
   * 尝试调度同一 agent 下所有等待中的 chat
   */
  private tryScheduleAgent(agentId: string): void {
    for (const chatKey of this.chatQueues.keys()) {
      if (chatKey.startsWith(`${agentId}:`)) {
        this.trySchedule(agentId, chatKey)
      }
    }
  }

  /**
   * 处理单个队列项
   */
  private async processItem(item: QueueItem, chatKey: string): Promise<void> {
    const logger = getLogger()

    logger.debug(
      { agentId: item.agentId, chatId: item.chatId, chatKey },
      '开始处理队列任务',
    )

    try {
      const managed = this.agentManager.getAgent(item.agentId)
      if (!managed) {
        throw new Error(`Agent not found: ${item.agentId}`)
      }

      // 更新 agent state
      managed.state.isProcessing = true

      const result = await managed.runtime.process({
        chatId: item.chatId,
        prompt: item.prompt,
        agentId: item.agentId,
        requestedSkills: item.requestedSkills,
        browserProfileId: item.browserProfileId,
        attachments: item.attachments,
      })

      // 更新 agent state
      managed.state.isProcessing = false
      managed.state.lastProcessedAt = new Date().toISOString()
      managed.state.totalProcessed++
      managed.state.lastError = null

      item.resolve(result)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      logger.error({ agentId: item.agentId, chatId: item.chatId, error: error.message }, '队列任务处理失败')

      // 更新 agent state
      const managed = this.agentManager.getAgent(item.agentId)
      if (managed) {
        managed.state.isProcessing = false
        managed.state.lastError = error.message
      }

      item.reject(error)
    }
  }

  /**
   * 更新 agent state 的 queueDepth
   */
  private updateQueueDepth(agentId: string): void {
    const managed = this.agentManager.getAgent(agentId)
    if (managed) {
      managed.state.queueDepth = this.getQueueDepth(agentId)
    }
  }
}
