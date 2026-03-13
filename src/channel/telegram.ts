import { Bot } from 'grammy'
import { getLogger } from '../logger/index.ts'
import type { Channel, InboundMessage, OnInboundMessage } from './types.ts'

const TELEGRAM_MAX_LENGTH = 4096

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage
}

export class TelegramChannel implements Channel {
  name = 'telegram'

  private bot: Bot | null = null
  private botToken: string
  private opts: TelegramChannelOpts

  constructor(botToken: string, opts: TelegramChannelOpts) {
    this.botToken = botToken
    this.opts = opts
  }

  async connect(): Promise<void> {
    const logger = getLogger()
    this.bot = new Bot(this.botToken)

    // /chatid — 回复当前 chat ID
    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id
      const chatType = ctx.chat.type
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : (ctx.chat as any).title || 'Unknown'

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      )
    })

    // /ping — 健康检查
    this.bot.command('ping', (ctx) => {
      ctx.reply('YouClaw is online.')
    })

    // 文本消息处理
    this.bot.on('message:text', async (ctx) => {
      // 只拦截已注册的 Telegram 内建命令，其余 / 消息放行（可能是 skill 调用）
      const builtinCommands = new Set(['chatid', 'ping'])
      if (ctx.message.text.startsWith('/')) {
        const firstWord = ctx.message.text.split(/\s/)[0]!
        const cmd = firstWord.slice(1).toLowerCase().split('@')[0]! // 处理 /chatid@bot_name 格式
        if (builtinCommands.has(cmd)) return
      }

      const chatId = `tg:${ctx.chat.id}`
      let content = ctx.message.text
      const timestamp = new Date(ctx.message.date * 1000).toISOString()
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown'
      const sender = ctx.from?.id.toString() || ''
      const msgId = ctx.message.message_id.toString()
      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup'

      // 处理 @mention：如果 bot 被 @ 提及，将 @bot_username 替换为 @YouClaw
      const botUsername = ctx.me?.username?.toLowerCase()
      if (botUsername) {
        const entities = ctx.message.entities || []
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase()
            return mentionText === `@${botUsername}`
          }
          return false
        })
        if (isBotMentioned) {
          // 将 @bot_username 替换为 @YouClaw 以便统一触发格式
          const regex = new RegExp(`@${botUsername}`, 'gi')
          content = content.replace(regex, '@YouClaw')
        }
      }

      const message: InboundMessage = {
        id: msgId,
        chatId,
        sender,
        senderName,
        content,
        timestamp,
        isGroup,
      }

      this.opts.onMessage(message)

      logger.debug(
        { chatId, sender: senderName },
        'Telegram message received',
      )
    })

    // 错误处理
    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error')
    })

    // 以 Long Polling 模式启动
    return new Promise<void>((resolve, reject) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          )
          resolve()
        },
      }).catch(reject)
    })
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const logger = getLogger()
    if (!this.bot) {
      logger.warn('Telegram bot not initialized, cannot send message')
      return
    }

    try {
      const numericId = chatId.replace(/^tg:/, '')

      // Telegram 限制每条消息最多 4096 字符，超长消息需要分片
      if (text.length <= TELEGRAM_MAX_LENGTH) {
        await this.bot.api.sendMessage(numericId, text, {
          parse_mode: 'Markdown',
        })
      } else {
        for (let i = 0; i < text.length; i += TELEGRAM_MAX_LENGTH) {
          const chunk = text.slice(i, i + TELEGRAM_MAX_LENGTH)
          await this.bot.api.sendMessage(numericId, chunk, {
            parse_mode: 'Markdown',
          })
        }
      }

      logger.debug({ chatId, length: text.length }, 'Telegram message sent')
    } catch (err) {
      logger.error({ chatId, err }, 'Failed to send Telegram message')
    }
  }

  isConnected(): boolean {
    return this.bot !== null
  }

  ownsChatId(chatId: string): boolean {
    return chatId.startsWith('tg:')
  }

  async disconnect(): Promise<void> {
    const logger = getLogger()
    if (this.bot) {
      this.bot.stop()
      this.bot = null
      logger.info('Telegram bot stopped')
    }
  }
}
