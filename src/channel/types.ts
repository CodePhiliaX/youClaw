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
  browserProfileId?: string | null   // null explicitly disables browser for this message
  attachments?: Array<{ filename: string; mediaType: string; filePath: string }>
}

export interface ChannelLoginStartResult {
  qrDataUrl?: string
  message: string
}

export interface ChannelLoginWaitResult {
  connected: boolean
  message: string
  accountId?: string
}

export interface ChannelAuthStatus {
  supportsQrLogin: boolean
  loggedIn: boolean
  connected: boolean
  accountId?: string
  accountLabel?: string
}

export interface Channel {
  name: string
  connect(): Promise<void>
  sendMessage(chatId: string, text: string): Promise<void>
  sendMedia?(chatId: string, text: string, mediaUrl: string): Promise<void>
  isConnected(): boolean
  ownsChatId(chatId: string): boolean
  disconnect(): Promise<void>
  loginWithQrStart?(params?: { force?: boolean; timeoutMs?: number; verbose?: boolean }): Promise<ChannelLoginStartResult>
  loginWithQrWait?(params?: { timeoutMs?: number }): Promise<ChannelLoginWaitResult>
  logout?(): Promise<{ cleared: boolean; message?: string }>
  getAuthStatus?(): Promise<ChannelAuthStatus>
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
  supportsQrLogin?: boolean
  loggedIn?: boolean
  accountLabel?: string
}
