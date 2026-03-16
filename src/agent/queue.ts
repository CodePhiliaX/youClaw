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
 * Two-layer queue
 * Outer: per-agent concurrency control (maxConcurrency)
 * Inner: per agentId:chatId ordering within the same conversation
 * Different chats under the same agent can run concurrently
 */
export class AgentQueue {
  // Inner: ordered queue per chat
  private chatQueues: Map<string, QueueItem[]> = new Map()    // `${agentId}:${chatId}` -> queue
  private chatRunning: Set<string> = new Set()                 // currently running chatKeys

  // Outer: per-agent concurrency control
  private agentRunning: Map<string, number> = new Map()        // agentId -> current running count
  private agentManager: AgentManager

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager
  }

  /**
   * Enqueue a message and return the agent's reply
   */
  async enqueue(agentId: string, chatId: string, prompt: string, requestedSkills?: string[], browserProfileId?: string, attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chatKey = `${agentId}:${chatId}`
      const queue = this.chatQueues.get(chatKey) ?? []
      queue.push({ agentId, chatId, prompt, requestedSkills, browserProfileId, attachments, resolve, reject })
      this.chatQueues.set(chatKey, queue)

      // Update agent state queueDepth
      this.updateQueueDepth(agentId)

      // Try to schedule
      this.trySchedule(agentId, chatKey)
    })
  }

  /**
   * Get the total queue depth for a given agent
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
   * Try to schedule the next task for a given chat
   */
  private trySchedule(agentId: string, chatKey: string): void {
    const logger = getLogger()

    // If this chat is already running, wait for completion then auto-schedule
    if (this.chatRunning.has(chatKey)) {
      const pending = this.chatQueues.get(chatKey)?.length ?? 0
      logger.info({ agentId, chatKey, pending, category: 'queue' }, 'Chat already running, request queued')
      return
    }

    // Check agent concurrency limit
    const managed = this.agentManager.getAgent(agentId)
    const maxConcurrency = managed?.config.maxConcurrency ?? 1
    const currentRunning = this.agentRunning.get(agentId) ?? 0

    if (currentRunning >= maxConcurrency) {
      logger.info({ agentId, chatKey, currentRunning, maxConcurrency, category: 'queue' }, 'Agent at max concurrency, request queued')
      return
    }

    // Dequeue the next task
    const queue = this.chatQueues.get(chatKey)
    if (!queue || queue.length === 0) return

    const item = queue.shift()!
    this.chatRunning.add(chatKey)
    this.agentRunning.set(agentId, currentRunning + 1)
    this.updateQueueDepth(agentId)

    // Execute asynchronously
    this.processItem(item, chatKey).finally(() => {
      this.chatRunning.delete(chatKey)
      const running = this.agentRunning.get(agentId) ?? 1
      this.agentRunning.set(agentId, Math.max(0, running - 1))
      this.updateQueueDepth(agentId)

      // Continue scheduling the next task for this chat
      this.trySchedule(agentId, chatKey)

      // Try scheduling tasks for other chats under the same agent
      this.tryScheduleAgent(agentId)
    })
  }

  /**
   * Try to schedule all pending chats under the same agent
   */
  private tryScheduleAgent(agentId: string): void {
    for (const chatKey of this.chatQueues.keys()) {
      if (chatKey.startsWith(`${agentId}:`)) {
        this.trySchedule(agentId, chatKey)
      }
    }
  }

  /**
   * Process a single queue item
   */
  private async processItem(item: QueueItem, chatKey: string): Promise<void> {
    const logger = getLogger()

    logger.info(
      { agentId: item.agentId, chatId: item.chatId, chatKey, category: 'queue' },
      'Processing queue task',
    )

    try {
      const managed = this.agentManager.getAgent(item.agentId)
      if (!managed) {
        throw new Error(`Agent not found: ${item.agentId}`)
      }

      // Update agent state
      managed.state.isProcessing = true

      const result = await managed.runtime.process({
        chatId: item.chatId,
        prompt: item.prompt,
        agentId: item.agentId,
        requestedSkills: item.requestedSkills,
        browserProfileId: item.browserProfileId,
        attachments: item.attachments,
      })

      // Update agent state
      managed.state.isProcessing = false
      managed.state.lastProcessedAt = new Date().toISOString()
      managed.state.totalProcessed++
      managed.state.lastError = null

      item.resolve(result)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      logger.error({ agentId: item.agentId, chatId: item.chatId, error: error.message }, 'Queue task processing failed')

      // Update agent state
      const managed = this.agentManager.getAgent(item.agentId)
      if (managed) {
        managed.state.isProcessing = false
        managed.state.lastError = error.message
      }

      item.reject(error)
    }
  }

  /**
   * Update agent state queueDepth
   */
  private updateQueueDepth(agentId: string): void {
    const managed = this.agentManager.getAgent(agentId)
    if (managed) {
      managed.state.queueDepth = this.getQueueDepth(agentId)
    }
  }
}
