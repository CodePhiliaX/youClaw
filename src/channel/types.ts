export interface InboundMessage {
  id: string
  chatId: string          // format: "tg:123456" or "web:uuid"
  sender: string
  senderName: string
  content: string
  timestamp: string
  isGroup: boolean
  channel?: string        // "telegram" | "web" | "api"
  agentId?: string        // target agent (Web API scenario)
  tags?: string[]         // routing tags from web frontend
  requestedSkills?: string[]  // explicitly requested skills
  browserProfileId?: string   // dynamically override agent.yaml browserProfile
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
 * Channel runtime status
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
