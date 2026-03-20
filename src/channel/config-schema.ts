import { z } from 'zod/v4'

// ===== Config schema for each channel type =====

export const TelegramConfigSchema = z.object({
  botToken: z.string().min(1),
})

export const FeishuConfigSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
})

export const QQConfigSchema = z.object({
  botAppId: z.string().min(1),
  botSecret: z.string().min(1),
})

export const WeComConfigSchema = z.object({
  corpId: z.string().min(1),
  corpSecret: z.string().min(1),
  agentId: z.string().min(1),
  token: z.string().min(1),
  encodingAESKey: z.string().min(1),
})

export const DingTalkConfigSchema = z.object({
  appKey: z.string().min(1),
  appSecret: z.string().min(1),
})

export const WechatOAConfigSchema = z.object({})

// ===== Config field descriptors =====

export interface ConfigFieldInfo {
  key: string
  label: string
  placeholder: string
  secret: boolean
}

// ===== Channel type metadata =====

export interface ChannelTypeInfo {
  type: string
  label: string
  description: string
  chatIdPrefix: string
  configFields: ConfigFieldInfo[]
  docsUrl: string
  configSchema: z.ZodType
  hidden?: boolean
}

export const CHANNEL_TYPE_REGISTRY: Record<string, ChannelTypeInfo> = {
  telegram: {
    type: 'telegram',
    label: 'Telegram',
    description: 'Telegram Bot API (Long Polling)',
    chatIdPrefix: 'tg:',
    configFields: [
      { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-DEF...', secret: true },
    ],
    docsUrl: 'https://core.telegram.org/bots',
    configSchema: TelegramConfigSchema,
  },
  feishu: {
    type: 'feishu',
    label: 'Feishu / Lark',
    description: 'Feishu Bot (WebSocket Long Connection)',
    chatIdPrefix: 'feishu:',
    configFields: [
      { key: 'appId', label: 'App ID', placeholder: 'cli_xxxxx', secret: false },
      { key: 'appSecret', label: 'App Secret', placeholder: '', secret: true },
    ],
    docsUrl: 'https://open.feishu.cn',
    configSchema: FeishuConfigSchema,
  },
  qq: {
    type: 'qq',
    label: 'QQ',
    description: 'QQ Bot API',
    chatIdPrefix: 'qq:',
    configFields: [
      { key: 'botAppId', label: 'Bot App ID', placeholder: '', secret: false },
      { key: 'botSecret', label: 'Bot Secret', placeholder: '', secret: true },
    ],
    docsUrl: 'https://q.qq.com',
    configSchema: QQConfigSchema,
  },
  wecom: {
    type: 'wecom',
    label: 'WeCom',
    description: 'WeCom Bot (Webhook Callback)',
    chatIdPrefix: 'wecom:',
    configFields: [
      { key: 'corpId', label: 'Corp ID', placeholder: 'ww...', secret: false },
      { key: 'corpSecret', label: 'Corp Secret', placeholder: '', secret: true },
      { key: 'agentId', label: 'Agent ID', placeholder: '1000001', secret: false },
      { key: 'token', label: 'Callback Token', placeholder: '', secret: true },
      { key: 'encodingAESKey', label: 'Encoding AES Key', placeholder: '43 chars', secret: true },
    ],
    docsUrl: 'https://developer.work.weixin.qq.com',
    configSchema: WeComConfigSchema,
    hidden: true,
  },
  dingtalk: {
    type: 'dingtalk',
    label: 'DingTalk',
    description: 'DingTalk Bot (Stream Mode)',
    chatIdPrefix: 'dingtalk:',
    configFields: [
      { key: 'appKey', label: 'App Key', placeholder: '', secret: false },
      { key: 'appSecret', label: 'App Secret', placeholder: '', secret: true },
    ],
    docsUrl: 'https://open.dingtalk.com',
    configSchema: DingTalkConfigSchema,
  },
  'wechat-oa': {
    type: 'wechat-oa',
    label: 'WeChat Official Account',
    description: 'WeChat Official Account via ReadmeX Bridge (Long Polling)',
    chatIdPrefix: 'wxoa:',
    configFields: [],
    docsUrl: 'https://readmex.com',
    configSchema: WechatOAConfigSchema,
  },
}

/**
 * Infer channel type from chatId prefix
 * Matches against registered chatIdPrefix entries
 */
export function inferChannelType(chatId: string): string {
  for (const info of Object.values(CHANNEL_TYPE_REGISTRY)) {
    if (chatId.startsWith(info.chatIdPrefix)) {
      return info.type
    }
  }
  return 'web'
}

/**
 * Validate config object by channel type
 */
export function validateChannelConfig(type: string, config: unknown): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const typeInfo = CHANNEL_TYPE_REGISTRY[type]
  if (!typeInfo) {
    return { success: false, error: `Unknown channel type: ${type}` }
  }

  const result = typeInfo.configSchema.safeParse(config)
  if (!result.success) {
    return { success: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }

  return { success: true, data: result.data as Record<string, unknown> }
}

/**
 * Mask secret fields in config (for GET responses)
 */
export function maskSecretFields(type: string, config: Record<string, unknown>): { masked: Record<string, string>; configuredFields: string[] } {
  const typeInfo = CHANNEL_TYPE_REGISTRY[type]
  const masked: Record<string, string> = {}
  const configuredFields: string[] = []

  if (!typeInfo) return { masked, configuredFields }

  for (const field of typeInfo.configFields) {
    const val = config[field.key]
    if (val && typeof val === 'string' && val.length > 0) {
      configuredFields.push(field.key)
      masked[field.key] = field.secret ? '' : val
    } else {
      masked[field.key] = ''
    }
  }

  return { masked, configuredFields }
}
