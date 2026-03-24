import { createContext, useContext } from 'react'
import type { Message, TimelineItem, ToolUseItem } from './useChat'
import type { ChatItem } from '../lib/chat-utils'
import type { Attachment } from '../types/attachment'
import type { BrowserProfileDTO } from '../api/client'

type Agent = { id: string; name: string }

export interface ChatContextType {
  chatId: string | null
  messages: Message[]
  timelineItems: TimelineItem[]
  streamingText: string
  isProcessing: boolean
  pendingToolUse: ToolUseItem[]
  documentStatuses: Record<string, { filename: string; status: 'parsing' | 'parsed' | 'failed'; error?: string }>
  chatStatus: 'submitted' | 'streaming' | 'ready' | 'error'
  send: (prompt: string, browserProfileId?: string | null, attachments?: Attachment[]) => Promise<void>
  loadChat: (chatId: string) => Promise<void>
  newChat: () => void
  stop: () => void
  showInsufficientCredits: boolean
  setShowInsufficientCredits: (show: boolean) => void

  chatList: ChatItem[]
  refreshChats: () => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  deleteChat: (chatId: string) => Promise<void>
  updateChat: (chatId: string, data: { name?: string; avatar?: string }) => Promise<void>

  agentId: string
  setAgentId: (id: string) => void
  agents: Agent[]
  refreshAgents: () => void

  browserProfiles: BrowserProfileDTO[]
  refreshBrowserProfiles: () => void
  selectedProfileId: string | null
  setSelectedProfileId: (id: string | null) => void
}

export const ChatContext = createContext<ChatContextType | null>(null)

export function useChatContext() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider')
  return ctx
}
