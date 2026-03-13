export interface InboundMessage {
  id: string
  chatId: string          // "tg:123456" 或 "web:uuid" 格式
  sender: string
  senderName: string
  content: string
  timestamp: string
  isGroup: boolean
  channel?: string        // "telegram" | "web" | "api"
  agentId?: string        // 指定目标 agent（Web API 场景）
  tags?: string[]         // web 前端传入的路由标签
  requestedSkills?: string[]  // 显式请求的 skills
  browserProfileId?: string   // 动态覆盖 agent.yaml 的 browserProfile
  attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>
}

export interface Channel {
  name: string
  connect(): Promise<void>
  sendMessage(chatId: string, text: string): Promise<void>
  isConnected(): boolean
  ownsChatId(chatId: string): boolean
  disconnect(): Promise<void>
}

export type OnInboundMessage = (message: InboundMessage) => void

/**
 * Channel 运行时状态
 */
export interface ChannelStatus {
  id: string
  type: string
  label: string
  connected: boolean
  enabled: boolean
  error?: string
  configuredFields: string[]
}
