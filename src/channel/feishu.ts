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
 * 飞书消息事件数据结构（im.message.receive_v1）
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
 * 从飞书消息 content JSON 中提取纯文本
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
 * 从富文本（post）消息中提取文本
 */
export function extractPostText(parsed: Record<string, unknown>): string {
  // post 格式：{ title?, content: [[{ tag, text?, ... }]] } 或 { zh_cn: { title?, content: [...] } }
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
        // @提及：保留 @name 格式
        if (element.user_name) {
          paraTexts.push(`@${element.user_name}`)
        }
      } else if (element.tag === 'img') {
        paraTexts.push('[图片]')
      }
    }
    if (paraTexts.length > 0) {
      parts.push(paraTexts.join(''))
    }
  }

  return parts.join('\n')
}

/**
 * 去除消息文本中对 bot 自身的 @提及
 */
export function stripBotMention(
  text: string,
  mentions: Array<{ key: string; id: { open_id?: string }; name: string }>,
  botOpenId: string,
): string {
  let result = text
  for (const mention of mentions) {
    if (mention.id.open_id === botOpenId) {
      // 去除 @bot 的占位符（如 @_user_1）和名称
      result = result.replace(new RegExp(mention.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
    }
  }
  return result.trim()
}

/**
 * 文本分片
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

    // 获取 bot 的 open_id（用于过滤 @mention）
    try {
      const response = await this.client.request<{ code: number; bot?: { open_id?: string; bot_name?: string }; data?: { bot?: { open_id?: string; bot_name?: string } } }>({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
        data: {},
      })
      const bot = response.bot || response.data?.bot
      if (bot?.open_id) {
        this.botOpenId = bot.open_id
        logger.info({ botOpenId: this.botOpenId, botName: bot.bot_name }, '飞书 bot 信息获取成功')
      }
    } catch (err) {
      logger.warn({ error: err }, '获取飞书 bot 信息失败，@mention 过滤可能不准确')
    }

    // 创建事件分发器
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        try {
          this.handleMessageEvent(data as FeishuMessageEvent)
        } catch (err) {
          logger.error({ error: err }, '处理飞书消息事件失败')
        }
      },
    })

    // 使用 WebSocket 长连接模式接收事件
    this.wsClient = new Lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: Lark.LoggerLevel.info,
    })

    await this.wsClient.start({ eventDispatcher })
    logger.info('飞书 WebSocket 长连接已启动')
    // WSClient.start 是异步的但没有回调，给一点时间让连接建立
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
   * 处理入站消息事件
   */
  private handleMessageEvent(event: FeishuMessageEvent): void {
    const logger = getLogger()
    const { sender, message: msg } = event

    // 只处理文本和富文本消息
    if (msg.message_type !== 'text' && msg.message_type !== 'post') {
      logger.debug({ messageType: msg.message_type }, '飞书：跳过非文本消息')
      return
    }

    // 提取文本内容
    let content = extractTextContent(msg.content, msg.message_type)
    if (!content) return

    // 处理 @mention：去除 bot 自身的 @提及
    if (msg.mentions && this.botOpenId) {
      content = stripBotMention(content, msg.mentions, this.botOpenId)
    }

    const chatId = `feishu:${msg.chat_id}`
    const senderId = sender.sender_id.open_id || sender.sender_id.user_id || 'unknown'
    const isGroup = msg.chat_type === 'group'

    // 从 mentions 中找发送者名称，否则用 open_id
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

    // 异步添加处理中 reaction（不阻塞消息处理）
    this.addProcessingReaction(msg.message_id, chatId)

    this.opts.onMessage(inbound)
    logger.debug({ chatId, sender: senderId, chatType: msg.chat_type }, '飞书消息已接收')
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const logger = getLogger()

    try {
      const feishuChatId = chatId.replace(/^feishu:/, '')

      // 长消息分片
      const chunks = chunkText(text, FEISHU_TEXT_CHUNK_LIMIT)

      for (const chunk of chunks) {
        // 判断是否包含代码块或表格，选择消息格式
        const shouldUseCard = /```[\s\S]*?```/.test(chunk) || /\|.+\|[\r\n]+\|[-:| ]+\|/.test(chunk)

        if (shouldUseCard) {
          await this.sendCard(feishuChatId, chunk)
        } else {
          await this.sendPost(feishuChatId, chunk)
        }
      }

      logger.debug({ chatId, length: text.length }, '飞书消息已发送')
    } catch (err) {
      logger.error({ chatId, error: err }, '飞书消息发送失败')
    }
  }

  /**
   * 以富文本（post）格式发送（支持基础 markdown）
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
   * 以交互卡片格式发送（支持代码块、表格等复杂 markdown）
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
        data: { reaction_type: { emoji_type: 'OnIt' } },
        path: { message_id: messageId },
      })
      if (res?.data?.reaction_id) {
        this.pendingReactions.set(chatId, { messageId, reactionId: res.data.reaction_id })
      }
    } catch (err) {
      getLogger().debug({ error: err, messageId }, '添加飞书 reaction 失败')
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
      getLogger().debug({ error: err, chatId }, '移除飞书 reaction 失败')
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
      logger.info('飞书 WebSocket 连接已关闭')
    }
  }
}
