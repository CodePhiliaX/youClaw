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

    // /chatid — reply with current chat ID
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

    // /ping — health check
    this.bot.command('ping', (ctx) => {
      ctx.reply('YouClaw is online.')
    })

    // Text message handler
    this.bot.on('message:text', async (ctx) => {
      // Only intercept registered Telegram built-in commands; other / messages pass through (may be skill invocations)
      const builtinCommands = new Set(['chatid', 'ping'])
      if (ctx.message.text.startsWith('/')) {
        const firstWord = ctx.message.text.split(/\s/)[0]!
        const cmd = firstWord.slice(1).toLowerCase().split('@')[0]! // handle /chatid@bot_name format
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

      // Handle @mention: if bot is mentioned, replace @bot_username with @YouClaw
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
          // Replace @bot_username with @YouClaw for unified trigger format
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

    // Error handler
    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error')
    })

    // Start in long polling mode
    return new Promise<void>((resolve, reject) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          )
          resolve()
        },
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ err: msg }, 'Telegram bot failed to start')
        this.bot = null
        reject(new Error(`Telegram bot failed to start: ${msg}`))
      })
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

      // Telegram limits each message to 4096 characters; longer messages need chunking
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
      try {
        await this.bot.stop()
      } catch (err) {
        // grammy's stop() internally calls getUpdates to confirm offset,
        // which may throw if token is invalid; safe to ignore
        logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'Telegram bot stop error (ignored)')
      }
      this.bot = null
      logger.info('Telegram bot stopped')
    }
  }
}
