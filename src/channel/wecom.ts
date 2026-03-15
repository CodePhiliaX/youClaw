import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getLogger } from '../logger/index.ts'
import type { Channel, InboundMessage, OnInboundMessage } from './types.ts'

const WECOM_API_BASE = 'https://qyapi.weixin.qq.com'
const WECOM_TEXT_CHUNK_LIMIT = 2048

export interface WeComChannelOpts {
  onMessage: OnInboundMessage
  _fetchFn?: typeof fetch
}

interface AccessToken {
  access_token: string
  expires_in: number
  fetchedAt: number
}

// ===== Pure functions (for unit testing) =====

/**
 * SHA1 signature verification
 */
export function generateSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  const arr = [token, timestamp, nonce, encrypt].sort()
  return createHash('sha1').update(arr.join('')).digest('hex')
}

/**
 * AES-256-CBC decrypt WeCom message
 */
export function decryptMessage(encodingAESKey: string, encryptedMsg: string): { message: string; corpId: string } {
  const aesKey = Buffer.from(encodingAESKey + '=', 'base64')
  const iv = aesKey.subarray(0, 16)

  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv)
  decipher.setAutoPadding(false)

  const decrypted = Buffer.concat([decipher.update(encryptedMsg, 'base64'), decipher.final()])

  // Remove PKCS#7 padding
  const padLen = decrypted[decrypted.length - 1]!
  const content = decrypted.subarray(0, decrypted.length - padLen)

  // Format: 16 bytes random + 4 bytes msg_len (big endian) + msg + corpId
  const msgLen = content.readUInt32BE(16)
  const message = content.subarray(20, 20 + msgLen).toString('utf-8')
  const corpId = content.subarray(20 + msgLen).toString('utf-8')

  return { message, corpId }
}

/**
 * AES-256-CBC encrypt reply message
 */
export function encryptMessage(encodingAESKey: string, corpId: string, content: string): string {
  const aesKey = Buffer.from(encodingAESKey + '=', 'base64')
  const iv = aesKey.subarray(0, 16)

  const random = randomBytes(16)
  const msgBuf = Buffer.from(content, 'utf-8')
  const msgLen = Buffer.alloc(4)
  msgLen.writeUInt32BE(msgBuf.length, 0)
  const corpIdBuf = Buffer.from(corpId, 'utf-8')

  const plaintext = Buffer.concat([random, msgLen, msgBuf, corpIdBuf])

  // PKCS#7 padding
  const blockSize = 32
  const padLen = blockSize - (plaintext.length % blockSize)
  const padding = Buffer.alloc(padLen, padLen)
  const padded = Buffer.concat([plaintext, padding])

  const cipher = createCipheriv('aes-256-cbc', aesKey, iv)
  cipher.setAutoPadding(false)
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])

  return encrypted.toString('base64')
}

/**
 * Extract key fields from XML using regex
 */
export function extractTextFromXml(xml: string): {
  msgType: string
  content: string
  fromUserName: string
  agentId: string
  msgId: string
  encrypt: string
} {
  const extract = (tag: string): string => {
    const cdataMatch = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>`))
    if (cdataMatch) return cdataMatch[1]!
    const plainMatch = xml.match(new RegExp(`<${tag}>(.+?)</${tag}>`))
    return plainMatch ? plainMatch[1]! : ''
  }

  return {
    msgType: extract('MsgType'),
    content: extract('Content'),
    fromUserName: extract('FromUserName'),
    agentId: extract('AgentID'),
    msgId: extract('MsgId'),
    encrypt: extract('Encrypt'),
  }
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

export class WeComChannel implements Channel {
  name = 'wecom'

  private corpId: string
  private corpSecret: string
  private agentId: string
  private token: string
  private encodingAESKey: string
  private opts: WeComChannelOpts
  private accessToken: AccessToken | null = null
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private _connected = false
  private fetchFn: typeof fetch

  constructor(
    corpId: string,
    corpSecret: string,
    agentId: string,
    token: string,
    encodingAESKey: string,
    opts: WeComChannelOpts,
  ) {
    this.corpId = corpId
    this.corpSecret = corpSecret
    this.agentId = agentId
    this.token = token
    this.encodingAESKey = encodingAESKey
    this.opts = opts
    this.fetchFn = opts._fetchFn ?? globalThis.fetch.bind(globalThis)
  }

  async connect(): Promise<void> {
    const logger = getLogger()

    // Obtain access_token
    await this.refreshToken()

    // Schedule automatic token refresh
    this.scheduleTokenRefresh()

    this._connected = true
    logger.info('WeCom Channel connected (waiting for webhook callbacks)')
  }

  /**
   * Handle GET callback verification
   */
  handleWebhookVerification(params: {
    msg_signature: string
    timestamp: string
    nonce: string
    echostr: string
  }): { success: boolean; echostr?: string; error?: string } {
    const { msg_signature, timestamp, nonce, echostr } = params

    // Verify signature
    const expectedSig = generateSignature(this.token, timestamp, nonce, echostr)
    if (expectedSig !== msg_signature) {
      return { success: false, error: 'Signature verification failed' }
    }

    // Decrypt echostr
    try {
      const { message } = decryptMessage(this.encodingAESKey, echostr)
      return { success: true, echostr: message }
    } catch (err) {
      return { success: false, error: `Failed to decrypt echostr: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /**
   * Handle POST message callback
   */
  handleWebhookMessage(
    params: { msg_signature: string; timestamp: string; nonce: string },
    body: string,
  ): { success: boolean; error?: string } {
    const logger = getLogger()

    // Extract Encrypt field from outer XML
    const outerEncrypt = extractTextFromXml(body).encrypt
    if (!outerEncrypt) {
      return { success: false, error: 'No Encrypt field in XML' }
    }

    // Verify signature
    const { msg_signature, timestamp, nonce } = params
    const expectedSig = generateSignature(this.token, timestamp, nonce, outerEncrypt)
    if (expectedSig !== msg_signature) {
      return { success: false, error: 'Signature verification failed' }
    }

    // Decrypt message
    try {
      const { message } = decryptMessage(this.encodingAESKey, outerEncrypt)

      // Extract message content from decrypted XML
      const parsed = extractTextFromXml(message)

      // Only process text messages
      if (parsed.msgType !== 'text') {
        logger.debug({ msgType: parsed.msgType }, 'WeCom: skipping non-text message')
        return { success: true }
      }

      if (!parsed.content.trim()) {
        return { success: true }
      }

      const chatId = `wecom:${parsed.fromUserName}`

      const inbound: InboundMessage = {
        id: parsed.msgId || `wecom-${Date.now()}`,
        chatId,
        sender: parsed.fromUserName,
        senderName: parsed.fromUserName,
        content: parsed.content.trim(),
        timestamp: new Date().toISOString(),
        isGroup: false,
        channel: 'wecom',
      }

      this.opts.onMessage(inbound)
      logger.debug({ chatId }, 'WeCom message received')
      return { success: true }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error({ error: errMsg }, 'WeCom message decryption failed')
      return { success: false, error: errMsg }
    }
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const logger = getLogger()

    try {
      // Ensure token is valid
      if (!this.accessToken || this.isTokenExpired()) {
        await this.refreshToken()
      }

      const toUser = chatId.replace(/^wecom:/, '')
      const chunks = chunkText(text, WECOM_TEXT_CHUNK_LIMIT)

      for (const chunk of chunks) {
        const res = await this.fetchFn(
          `${WECOM_API_BASE}/cgi-bin/message/send?access_token=${this.accessToken!.access_token}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              touser: toUser,
              msgtype: 'text',
              agentid: parseInt(this.agentId, 10),
              text: { content: chunk },
            }),
          },
        )

        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          logger.error({ chatId, status: res.status, body: errText }, 'WeCom message send failed')
        }
      }

      logger.debug({ chatId, length: text.length }, 'WeCom message sent')
    } catch (err) {
      logger.error({ chatId, error: err }, 'WeCom message send error')
    }
  }

  isConnected(): boolean {
    return this._connected
  }

  ownsChatId(chatId: string): boolean {
    return chatId.startsWith('wecom:')
  }

  async disconnect(): Promise<void> {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer)
      this.tokenRefreshTimer = null
    }
    this._connected = false
    getLogger().info('WeCom channel disconnected')
  }

  private isTokenExpired(): boolean {
    if (!this.accessToken) return true
    const elapsed = Date.now() - this.accessToken.fetchedAt
    // Consider expired 5 minutes early
    return elapsed >= (this.accessToken.expires_in - 300) * 1000
  }

  private async refreshToken(): Promise<void> {
    const logger = getLogger()
    let lastError: Error | null = null

    for (let i = 0; i < 3; i++) {
      try {
        const res = await this.fetchFn(
          `${WECOM_API_BASE}/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.corpSecret}`,
        )

        if (!res.ok) {
          throw new Error(`Token request failed: ${res.status} ${res.statusText}`)
        }

        const data = (await res.json()) as { access_token: string; expires_in: number; errcode?: number; errmsg?: string }
        if (data.errcode && data.errcode !== 0) {
          throw new Error(`WeCom API error: ${data.errcode} ${data.errmsg}`)
        }

        this.accessToken = {
          access_token: data.access_token,
          expires_in: data.expires_in,
          fetchedAt: Date.now(),
        }

        logger.debug({ expiresIn: data.expires_in }, 'WeCom access_token refreshed')
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        const delay = 5000 * Math.pow(2, i)
        logger.warn({ attempt: i + 1, delay, error: lastError.message }, 'WeCom token refresh failed, retrying')
        if (i < 2) await new Promise((r) => setTimeout(r, delay))
      }
    }

    throw new Error(`WeCom token refresh failed (3 retries): ${lastError?.message}`)
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer)

    if (!this.accessToken) return

    // Refresh 5 minutes before expiry
    const refreshIn = Math.max((this.accessToken.expires_in - 300) * 1000, 60000)
    this.tokenRefreshTimer = setTimeout(async () => {
      try {
        await this.refreshToken()
        this.scheduleTokenRefresh()
      } catch (err) {
        getLogger().error({ error: err instanceof Error ? err.message : String(err) }, 'WeCom token auto-refresh failed')
      }
    }, refreshIn)
  }
}
