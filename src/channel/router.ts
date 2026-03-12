import { AgentManager } from '../agent/manager.ts'
import { AgentQueue } from '../agent/queue.ts'
import { EventBus } from '../events/bus.ts'
import { saveMessage, upsertChat } from '../db/index.ts'
import { randomUUID } from 'node:crypto'
import { getLogger } from '../logger/index.ts'
import type { MemoryManager } from '../memory/index.ts'
import type { SkillsLoader } from '../skills/index.ts'
import { parseSkillInvocations } from '../skills/invoke.ts'
import type { InboundMessage, Channel } from './types.ts'

export class MessageRouter {
  private channels: Channel[] = []
  private memoryManager: MemoryManager | null = null
  private skillsLoader: SkillsLoader | null = null

  constructor(
    private agentManager: AgentManager,
    private agentQueue: AgentQueue,
    private eventBus: EventBus,
    memoryManager?: MemoryManager,
    skillsLoader?: SkillsLoader,
  ) {
    if (memoryManager) {
      this.memoryManager = memoryManager
    }
    if (skillsLoader) {
      this.skillsLoader = skillsLoader
    }
    // 订阅 complete 事件，自动发送回复到对应 channel
    this.eventBus.subscribe({ types: ['complete'] }, (event) => {
      if (event.type === 'complete') {
        this.handleOutbound(event.chatId, event.fullText)
      }
    })
  }

  addChannel(channel: Channel) {
    this.channels.push(channel)
  }

  // 处理入站消息（从任何 channel 进来）
  async handleInbound(message: InboundMessage): Promise<void> {
    const logger = getLogger()

    // 推断 channel 类型（优先用消息自带的 channel 字段，否则遍历已注册 channels 匹配）
    const channel = message.channel ?? this.inferChannel(message.chatId)

    // 优先使用消息中指定的 agentId（Web API 场景），否则按 chatId 路由
    const managed = message.agentId
      ? this.agentManager.getAgent(message.agentId)
      : this.agentManager.resolveAgent(message.chatId)
    if (!managed) {
      logger.warn({ chatId: message.chatId, agentId: message.agentId }, '没有找到对应的 agent')
      return
    }

    const { config } = managed

    // 检查 trigger（群聊场景）
    if (message.isGroup && config.requiresTrigger !== false) {
      const trigger = config.trigger ? new RegExp(config.trigger, 'i') : null
      if (trigger && !trigger.test(message.content)) {
        return // 群聊中没被触发，忽略
      }
    }

    // 解析 skill 调用（来自消息本身或已由上游解析）
    let requestedSkills = message.requestedSkills ?? []
    let contentForAgent = message.content

    if (requestedSkills.length === 0 && this.skillsLoader) {
      const allSkills = this.skillsLoader.loadAllSkills()
      const knownNames = new Set(allSkills.filter((s) => s.usable).map((s) => s.name))
      const parsed = parseSkillInvocations(message.content, knownNames)
      requestedSkills = parsed.requestedSkills
      contentForAgent = parsed.cleanContent || message.content
    }

    // 存入数据库
    upsertChat(message.chatId, config.id, message.senderName, channel)
    saveMessage({
      id: message.id,
      chatId: message.chatId,
      sender: message.sender,
      senderName: message.senderName,
      content: message.content,
      timestamp: message.timestamp,
      isFromMe: false,
      isBotMessage: false,
    })

    logger.info({ agentId: config.id, chatId: message.chatId, requestedSkills }, '路由消息到 agent')

    // 入队处理（传递 requestedSkills）
    try {
      const reply = await this.agentQueue.enqueue(
        config.id,
        message.chatId,
        contentForAgent,
        requestedSkills.length > 0 ? requestedSkills : undefined,
        message.browserProfileId,
      )

      // 存储 bot 回复
      saveMessage({
        id: randomUUID(),
        chatId: message.chatId,
        sender: 'assistant',
        senderName: config.name,
        content: reply,
        timestamp: new Date().toISOString(),
        isFromMe: true,
        isBotMessage: true,
      })

      // 记录到每日日志
      if (this.memoryManager) {
        try {
          this.memoryManager.appendDailyLog(config.id, message.chatId, message.content, reply, config.memory?.maxLogEntryLength)
        } catch (logErr) {
          getLogger().error({ error: logErr, agentId: config.id }, '记录每日日志失败')
        }
      }
    } catch (err) {
      logger.error({ error: err, chatId: message.chatId }, '消息处理失败')
    }
  }

  // 获取所有已注册 channel 的状态
  getChannelStatuses(): Array<{ name: string; connected: boolean }> {
    return this.channels.map((ch) => ({
      name: ch.name,
      connected: ch.isConnected(),
    }))
  }

  // 根据 chatId 前缀推断 channel 名称
  private inferChannel(chatId: string): string {
    for (const ch of this.channels) {
      if (ch.ownsChatId(chatId)) return ch.name
    }
    return 'web'
  }

  // 处理出站消息（发送到对应 channel）
  private async handleOutbound(chatId: string, text: string) {
    for (const channel of this.channels) {
      if (channel.ownsChatId(chatId)) {
        try {
          await channel.sendMessage(chatId, text)
        } catch (err) {
          getLogger().error({ error: err, chatId }, 'channel 发送失败')
        }
        return
      }
    }
  }
}
