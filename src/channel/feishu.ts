import * as Lark from '@larksuiteoapi/node-sdk'
import { getLogger } from '../logger/index.ts'
import type { EventBus } from '../events/bus.ts'
import type { Channel, InboundMessage, OnInboundMessage } from './types.ts'

const FEISHU_TEXT_CHUNK_LIMIT = 4000

export interface FeishuChannelOpts {
  onMessage: OnInboundMessage
  eventBus?: EventBus
  _client?: Lark.Client  // for test injection
}

/**
 * Feishu message event data structure (im.message.receive_v1)
 */
interface FeishuMessageEvent {
  sender: {
    sender_id: {
      open_id?: string
      user_id?: string
      union_id?: string
    }
    sender_type?: string
    tenant_key?: string
  }
  message: {
    message_id: string
    root_id?: string
    parent_id?: string
    chat_id: string
    chat_type: 'p2p' | 'group'
    message_type: string
    content: string
    mentions?: Array<{
      key: string
      id: { open_id?: string; user_id?: string; union_id?: string }
      name: string
      tenant_key?: string
    }>
  }
}

/**
 * Extract plain text from Feishu message content JSON
 */
export function extractTextContent(contentJson: string, messageType: string): string {
  try {
    const parsed = JSON.parse(contentJson)

    if (messageType === 'text') {
      return (parsed.text as string) || ''
    }

    if (messageType === 'post') {
      return extractPostText(parsed)
    }

    return ''
  } catch {
    return contentJson
  }
}

/**
 * Extract text from rich text (post) messages
 */
export function extractPostText(parsed: Record<string, unknown>): string {
  // post format: { title?, content: [[{ tag, text?, ... }]] } or { zh_cn: { title?, content: [...] } }
  const postBody = (parsed.zh_cn || parsed.en_us || parsed) as Record<string, unknown>
  const title = (postBody.title as string) || ''
  const contentBlocks = (postBody.content || []) as Array<Array<Record<string, unknown>>>

  const parts: string[] = []
  if (title) parts.push(title)

  for (const paragraph of contentBlocks) {
    const paraTexts: string[] = []
    for (const element of paragraph) {
      if (element.tag === 'text') {
        paraTexts.push(element.text as string)
      } else if (element.tag === 'a') {
        paraTexts.push((element.text as string) || (element.href as string) || '')
      } else if (element.tag === 'at') {
        // @mention: preserve @name format
        if (element.user_name) {
          paraTexts.push(`@${element.user_name}`)
        }
      } else if (element.tag === 'img') {
        paraTexts.push('[image]')
      }
    }
    if (paraTexts.length > 0) {
      parts.push(paraTexts.join(''))
    }
  }

  return parts.join('\n')
}

/**
 * Strip @mentions of the bot itself from message text
 */
export function stripBotMention(
  text: string,
  mentions: Array<{ key: string; id: { open_id?: string }; name: string }>,
  botOpenId: string,
): string {
  let result = text
  for (const mention of mentions) {
    if (mention.id.open_id === botOpenId) {
      // Remove @bot placeholder (e.g. @_user_1) and name
      result = result.replace(new RegExp(mention.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
    }
  }
  return result.trim()
}

/**
 * Split text into chunks
 */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.slice(i, i + limit))
  }
  return chunks
}

export class FeishuChannel implements Channel {
  name = 'feishu'

  private client: Lark.Client
  private wsClient: Lark.WSClient | null = null
  private _connected = false
  private appId: string
  private appSecret: string
  private opts: FeishuChannelOpts
  private botOpenId: string | null = null
  private eventBus: EventBus | null = null
  private unsubscribeEvents: (() => void) | null = null
  private pendingReactions: Map<string, { messageId: string; reactionId: string }> = new Map()

  constructor(appId: string, appSecret: string, opts: FeishuChannelOpts) {
    this.appId = appId
    this.appSecret = appSecret
    this.opts = opts
    this.eventBus = opts.eventBus ?? null

    this.client = opts._client ?? new Lark.Client({
      appId,
      appSecret,
      appType: Lark.AppType.SelfBuild,
    })
  }

  async connect(): Promise<void> {
    const logger = getLogger()

    // Get bot's open_id (used for @mention filtering)
    try {
      const response = await this.client.request<{ code: number; bot?: { open_id?: string; bot_name?: string }; data?: { bot?: { open_id?: string; bot_name?: string } } }>({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
        data: {},
      })
      const bot = response.bot || response.data?.bot
      if (bot?.open_id) {
        this.botOpenId = bot.open_id
        logger.info({ botOpenId: this.botOpenId, botName: bot.bot_name }, 'Feishu bot info retrieved')
      }
    } catch (err) {
      logger.warn({ error: err }, 'Failed to get Feishu bot info, @mention filtering may be inaccurate')
    }

    // Create event dispatcher
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        try {
          this.handleMessageEvent(data as FeishuMessageEvent)
        } catch (err) {
          logger.error({ error: err }, 'Failed to process Feishu message event')
        }
      },
    })

    // Use WebSocket long connection to receive events
    this.wsClient = new Lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: Lark.LoggerLevel.info,
    })

    await this.wsClient.start({ eventDispatcher })
    logger.info('Feishu WebSocket long connection started')
    // WSClient.start is async without callback, give some time for connection
    await new Promise<void>(r => setTimeout(r, 1500))
    this._connected = true

    if (this.eventBus) {
      this.unsubscribeEvents = this.eventBus.subscribe(
        { types: ['complete', 'error'] },
        (event) => {
          if ('chatId' in event && event.chatId?.startsWith('feishu:')) {
            this.removeProcessingReaction(event.chatId)
          }
        }
      )
    }
  }

  /**
   * Handle inbound message event
   */
  private handleMessageEvent(event: FeishuMessageEvent): void {
    const logger = getLogger()
    const { sender, message: msg } = event

    // Only process text and rich text messages
    if (msg.message_type !== 'text' && msg.message_type !== 'post') {
      logger.debug({ messageType: msg.message_type }, 'Feishu: skipping non-text message')
      return
    }

    // Extract text content
    let content = extractTextContent(msg.content, msg.message_type)
    if (!content) return

    // Handle @mention: strip bot's own @mentions
    if (msg.mentions && this.botOpenId) {
      content = stripBotMention(content, msg.mentions, this.botOpenId)
    }

    const chatId = `feishu:${msg.chat_id}`
    const senderId = sender.sender_id.open_id || sender.sender_id.user_id || 'unknown'
    const isGroup = msg.chat_type === 'group'

    // Find sender name from mentions, otherwise use open_id
    const senderName = senderId

    const inbound: InboundMessage = {
      id: msg.message_id,
      chatId,
      sender: senderId,
      senderName,
      content,
      timestamp: new Date().toISOString(),
      isGroup,
      channel: 'feishu',
    }

    // Asynchronously add processing reaction (non-blocking)
    this.addProcessingReaction(msg.message_id, chatId)

    this.opts.onMessage(inbound)
    logger.debug({ chatId, sender: senderId, chatType: msg.chat_type }, 'Feishu message received')
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const logger = getLogger()

    try {
      const feishuChatId = chatId.replace(/^feishu:/, '')

      // Long message chunking
      const chunks = chunkText(text, FEISHU_TEXT_CHUNK_LIMIT)

      for (const chunk of chunks) {
        // Check for code blocks or tables to choose message format
        const shouldUseCard = /```[\s\S]*?```/.test(chunk) || /\|.+\|[\r\n]+\|[-:| ]+\|/.test(chunk)

        if (shouldUseCard) {
          await this.sendCard(feishuChatId, chunk)
        } else {
          await this.sendPost(feishuChatId, chunk)
        }
      }

      logger.debug({ chatId, length: text.length }, 'Feishu message sent')
    } catch (err) {
      logger.error({ chatId, error: err }, 'Feishu message send failed')
    }
  }

  /**
   * Send in rich text (post) format (supports basic markdown)
   */
  private async sendPost(chatId: string, text: string): Promise<void> {
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'post',
        content: JSON.stringify({
          zh_cn: {
            content: [[{ tag: 'md', text }]],
          },
        }),
      },
    })
  }

  /**
   * Send as interactive card (supports code blocks, tables, etc.)
   */
  private async sendCard(chatId: string, text: string): Promise<void> {
    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify({
          schema: '2.0',
          config: { wide_screen_mode: true },
          body: {
            elements: [{ tag: 'markdown', content: text }],
          },
        }),
      },
    })
  }

  private async addProcessingReaction(messageId: string, chatId: string): Promise<void> {
    try {
      const res = await this.client.im.messageReaction.create({
        data: { reaction_type: { emoji_type: 'Typing' } },
        path: { message_id: messageId },
      })
      if (res?.data?.reaction_id) {
        this.pendingReactions.set(chatId, { messageId, reactionId: res.data.reaction_id })
      }
    } catch (err) {
      getLogger().debug({ error: err, messageId }, 'Failed to add Feishu reaction')
    }
  }

  private async removeProcessingReaction(chatId: string): Promise<void> {
    const pending = this.pendingReactions.get(chatId)
    if (!pending) return
    this.pendingReactions.delete(chatId)
    try {
      await this.client.im.messageReaction.delete({
        path: { message_id: pending.messageId, reaction_id: pending.reactionId },
      })
    } catch (err) {
      getLogger().debug({ error: err, chatId }, 'Failed to remove Feishu reaction')
    }
  }

  isConnected(): boolean {
    return this._connected
  }

  ownsChatId(chatId: string): boolean {
    return chatId.startsWith('feishu:')
  }

  async disconnect(): Promise<void> {
    const logger = getLogger()
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents()
      this.unsubscribeEvents = null
    }
    if (this.wsClient) {
      try {
        this.wsClient.close()
      } catch {
        // ignore close errors
      }
      this.wsClient = null
      this._connected = false
      logger.info('Feishu WebSocket connection closed')
    }
  }
}
