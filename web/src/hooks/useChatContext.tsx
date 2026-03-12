import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useChat, type Message, type ToolUseItem } from './useChat'
import { getChats, getAgents, deleteChat as deleteChatApi, getBrowserProfiles, type BrowserProfileDTO } from '../api/client'
import type { ChatItem } from '../lib/chat-utils'
import type { Attachment } from '../types/attachment'

type Agent = { id: string; name: string }

interface ChatContextType {
  // useChat 暴露的所有状态
  chatId: string | null
  messages: Message[]
  streamingText: string
  isProcessing: boolean
  pendingToolUse: ToolUseItem[]
  chatStatus: 'submitted' | 'streaming' | 'ready' | 'error'
  send: (prompt: string, browserProfileId?: string, attachments?: Attachment[]) => Promise<void>
  loadChat: (chatId: string) => Promise<void>
  newChat: () => void
  stop: () => void

  // 会话列表
  chatList: ChatItem[]
  refreshChats: () => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  deleteChat: (chatId: string) => Promise<void>

  // Agent 选择
  agentId: string
  setAgentId: (id: string) => void
  agents: Agent[]

  // 浏览器 Profile
  browserProfiles: BrowserProfileDTO[]
  selectedProfileId: string | null
  setSelectedProfileId: (id: string | null) => void
}

const ChatContext = createContext<ChatContextType | null>(null)

export function useChatContext() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider')
  return ctx
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [agentId, setAgentId] = useState('default')
  const [agents, setAgents] = useState<Agent[]>([])
  const [chatList, setChatList] = useState<ChatItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [browserProfiles, setBrowserProfiles] = useState<BrowserProfileDTO[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)

  const chat = useChat(agentId)

  // 加载 agents
  useEffect(() => {
    getAgents()
      .then(list => setAgents(list.map(a => ({ id: a.id, name: a.name }))))
      .catch(() => {})
  }, [])

  // 加载浏览器 Profiles
  useEffect(() => {
    getBrowserProfiles().then(setBrowserProfiles).catch(() => {})
  }, [])

  // 加载聊天列表
  const refreshChats = useCallback(() => {
    getChats().then(setChatList).catch(() => {})
  }, [])

  useEffect(() => { refreshChats() }, [chat.chatId, refreshChats])

  const chatRef = useRef(chat)
  chatRef.current = chat

  const deleteChat = useCallback(async (chatIdToDelete: string) => {
    await deleteChatApi(chatIdToDelete)
    if (chatRef.current.chatId === chatIdToDelete) chatRef.current.newChat()
    refreshChats()
  }, [refreshChats])

  return (
    <ChatContext.Provider value={{
      ...chat,
      chatList,
      refreshChats,
      searchQuery,
      setSearchQuery,
      deleteChat,
      agentId,
      setAgentId,
      agents,
      browserProfiles,
      selectedProfileId,
      setSelectedProfileId,
    }}>
      {children}
    </ChatContext.Provider>
  )
}
