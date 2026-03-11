export interface InboundMessage {
  id: string
  chatId: string          // "tg:123456" 或 "web:uuid" 格式
  sender: string
  senderName: string
  content: string
  timestamp: string
  isGroup: boolean
  channel?: string        // "telegram" | "web" | "api"
  tags?: string[]         // web 前端传入的路由标签
  requestedSkills?: string[]  // 显式请求的 skills
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
