import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useChat } from './useChat'
import { getChats, getAgents, deleteChat as deleteChatApi, getBrowserProfiles } from '../api/client'
import { getItem, setItem, removeItem } from '@/lib/storage'
import { ChatContext } from './chatCtx'

const LAST_AGENT_KEY = 'last-agent-id'
const chatKey = (agentId: string) => `last-chat:${agentId}`

type Agent = { id: string; name: string }

export function ChatProvider({ children }: { children: ReactNode }) {
  const [agentId, setAgentId] = useState('default')
  const [agents, setAgents] = useState<Agent[]>([])
  const [chatList, setChatList] = useState<ChatItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [browserProfiles, setBrowserProfiles] = useState<BrowserProfileDTO[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const chat = useChat(agentId)

  // 启动时异步加载上次的 agentId
  useEffect(() => {
    getItem(LAST_AGENT_KEY).then(saved => {
      if (saved) setAgentId(saved)
      setReady(true)
    })
  }, [])

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

  useEffect(() => { refreshChats() }, [chat.chatId, chat.messages.length, refreshChats])

  // 持久化 agentId
  useEffect(() => {
    if (ready) setItem(LAST_AGENT_KEY, agentId)
  }, [agentId, ready])

  // 持久化当前 agent 的 chatId
  useEffect(() => {
    if (chat.chatId) setItem(chatKey(agentId), chat.chatId)
  }, [chat.chatId, agentId])

  // 切换 agent 或首次加载时，恢复该 agent 的上次会话
  const prevAgentRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ready) return
    if (prevAgentRef.current === agentId) return
    prevAgentRef.current = agentId
    getItem(chatKey(agentId)).then(lastChatId => {
      if (lastChatId) {
        chat.loadChat(lastChatId).catch(() => {
          removeItem(chatKey(agentId))
          chat.newChat()
        })
      } else {
        chat.newChat()
      }
    })
  }, [agentId, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const chatRef = useRef(chat)
  useEffect(() => { chatRef.current = chat })

  const deleteChat = useCallback(async (chatIdToDelete: string) => {
    await deleteChatApi(chatIdToDelete)
    if (chatRef.current.chatId === chatIdToDelete) chatRef.current.newChat()
    // 清理所有 agent 下匹配的存储记录
    for (const a of agents) {
      const saved = await getItem(chatKey(a.id))
      if (saved === chatIdToDelete) {
        await removeItem(chatKey(a.id))
      }
    }
    refreshChats()
  }, [refreshChats, agents])

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
