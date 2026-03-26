import { AgentManager } from '../agent/manager.ts'
import { AgentQueue } from '../agent/queue.ts'
import { EventBus } from '../events/bus.ts'
import { saveMessage, upsertChat, getDatabase } from '../db/index.ts'
import { randomUUID } from 'node:crypto'
import { getLogger } from '../logger/index.ts'
import type { MemoryManager } from '../memory/index.ts'
import type { SkillsLoader } from '../skills/index.ts'
import { injectMessageTimestamp } from '../agent/message-timestamp.ts'
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
    // Subscribe to complete events, auto-send replies to the corresponding channel
    this.eventBus.subscribe({ types: ['complete'] }, (event) => {
      if (event.type === 'complete') {
        this.handleOutbound(event.chatId, event.fullText)
      }
    })
  }

  addChannel(channel: Channel) {
    this.channels.push(channel)
  }

  removeChannel(name: string) {
    this.channels = this.channels.filter((ch) => ch.name !== name)
  }

  // Handle inbound messages (from any channel)
  async handleInbound(message: InboundMessage): Promise<void> {
    const logger = getLogger()

    // Infer channel type (prefer message's channel field, otherwise match against registered channels)
    const channel = message.channel ?? this.inferChannel(message.chatId)

    // Prefer agentId from message (Web API scenario), otherwise route by chatId
    const managed = message.agentId
      ? this.agentManager.getAgent(message.agentId)
      : this.agentManager.resolveAgent(message.chatId)
    if (!managed) {
      logger.warn({ chatId: message.chatId, agentId: message.agentId }, 'No matching agent found')
      return
    }

    const { config } = managed

    // Check trigger (group chat scenario)
    if (message.isGroup && config.requiresTrigger !== false) {
      const trigger = config.trigger ? new RegExp(config.trigger, 'i') : null
      if (trigger && !trigger.test(message.content)) {
        return // not triggered in group chat, ignore
      }
    }

    // Parse skill invocations (from message itself or already parsed upstream)
    let requestedSkills = message.requestedSkills ?? []
    let contentForAgent = message.content

    if (requestedSkills.length === 0 && this.skillsLoader) {
      const knownNames = this.skillsLoader.getUsableSkillNamesForAgent(config)
      const parsed = parseSkillInvocations(message.content, knownNames)
      requestedSkills = parsed.requestedSkills
      contentForAgent = parsed.cleanContent || message.content
    }

    // Check if chat already exists (for new_chat event)
    const chatTitle = message.content.replace(/\n/g, ' ').slice(0, 50)
    const db = getDatabase()
    const existingChat = db.query("SELECT 1 FROM chats WHERE chat_id = ?").get(message.chatId)

    // Deduplicate: skip if this message already exists (non-web channels only, web uses fresh UUIDs)
    if (channel !== 'web') {
      const existing = db.query('SELECT 1 FROM messages WHERE id = ? AND chat_id = ?').get(message.id, message.chatId)
      if (existing) {
        logger.debug({ id: message.id, chatId: message.chatId, channel }, 'Duplicate message skipped')
        return
      }
    }

    // Save to database
    upsertChat(message.chatId, config.id, chatTitle, channel)
    saveMessage({
      id: message.id,
      chatId: message.chatId,
      sender: message.sender,
      senderName: message.senderName,
      content: message.content,
      timestamp: message.timestamp,
      isFromMe: false,
      isBotMessage: false,
      attachments: message.attachments ? JSON.stringify(message.attachments) : undefined,
    })

    // Emit events for frontend real-time updates
    if (!existingChat) {
      this.eventBus.emit({ type: 'new_chat', agentId: config.id, chatId: message.chatId, name: chatTitle, channel })
    }
    this.eventBus.emit({
      type: 'inbound_message', agentId: config.id, chatId: message.chatId,
      messageId: message.id, content: message.content, senderName: message.senderName, timestamp: message.timestamp,
    })

    logger.info({ agentId: config.id, chatId: message.chatId, requestedSkills }, 'Routing message to agent')

    // Enqueue for processing (pass requestedSkills)
    try {
      const contentForModel = injectMessageTimestamp(contentForAgent, {
        timestamp: message.timestamp,
      })

      const reply = await this.agentQueue.enqueue(
        config.id,
        message.chatId,
        contentForModel,
        {
          requestedSkills: requestedSkills.length > 0 ? requestedSkills : undefined,
          browserProfileId: message.browserProfileId,
          attachments: message.attachments,
          afterResult: async (result) => {
            if (!this.memoryManager) return

            try {
              this.memoryManager.appendDailyLog(
                config.id,
                message.chatId,
                message.content,
                result,
                config.memory?.maxLogEntryLength,
              )
            } catch (logErr) {
              getLogger().error({ error: logErr, agentId: config.id }, 'Failed to append daily log')
            }

            if (message.isGroup || config.memory?.enabled === false) {
              return
            }

            try {
              await this.memoryManager.rememberTurn(config.id, message.chatId, message.content, result)
            } catch (memoryErr) {
              getLogger().error({ error: memoryErr, agentId: config.id }, 'Failed to append daily memory note')
            }
          },
        },
      )

      if (!reply.trim()) {
        logger.warn({ agentId: config.id, chatId: message.chatId }, 'Agent returned an empty reply, skipping assistant message persistence')
        return
      }

      // Store bot reply
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
    } catch (err) {
      logger.error({ error: err, chatId: message.chatId }, 'Message processing failed')
    }
  }

  // Get statuses of all registered channels
  getChannelStatuses(): Array<{ name: string; connected: boolean }> {
    return this.channels.map((ch) => ({
      name: ch.name,
      connected: ch.isConnected(),
    }))
  }

  // Infer channel name from chatId prefix
  private inferChannel(chatId: string): string {
    for (const ch of this.channels) {
      if (ch.ownsChatId(chatId)) return ch.name
    }
    return 'web'
  }

  // Handle outbound messages (send to the corresponding channel)
  private async handleOutbound(chatId: string, text: string) {
    for (const channel of this.channels) {
      if (channel.ownsChatId(chatId)) {
        try {
          await channel.sendMessage(chatId, text)
        } catch (err) {
          getLogger().error({ error: err, chatId }, 'Channel send failed')
        }
        return
      }
    }
  }
}
