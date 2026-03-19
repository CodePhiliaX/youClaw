import { create } from 'zustand'
import type { Attachment } from '../types/attachment'

export type ToolUseItem = {
  id: string
  name: string
  input?: string
  status: 'running' | 'done'
}

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolUse?: ToolUseItem[]
  attachments?: Attachment[]
  errorCode?: string
}

export interface ChatState {
  chatId: string
  messages: Message[]
  streamingText: string
  isProcessing: boolean
  pendingToolUse: ToolUseItem[]
  documentStatuses: Record<string, { filename: string; status: 'parsing' | 'parsed' | 'failed'; error?: string }>
  chatStatus: 'submitted' | 'streaming' | 'ready' | 'error'
  showInsufficientCredits: boolean
  sseErrorHandled: boolean
}

// Callback for notifying external subscribers (e.g. ChatProvider refreshChats)
type ChatUpdateListener = () => void
const chatUpdateListeners = new Set<ChatUpdateListener>()

export function onChatUpdate(listener: ChatUpdateListener): () => void {
  chatUpdateListeners.add(listener)
  return () => chatUpdateListeners.delete(listener)
}

function notifyChatUpdate() {
  for (const listener of chatUpdateListeners) {
    listener()
  }
}

function defaultChatState(chatId: string): ChatState {
  return {
    chatId,
    messages: [],
    streamingText: '',
    isProcessing: false,
    pendingToolUse: [],
    documentStatuses: {},
    chatStatus: 'ready',
    showInsufficientCredits: false,
    sseErrorHandled: false,
  }
}

// Helper to immutably update a specific chat in the record
function updateChat(
  chats: Record<string, ChatState>,
  chatId: string,
  updater: (chat: ChatState) => Partial<ChatState>,
): Record<string, ChatState> {
  const chat = chats[chatId]
  if (!chat) return chats
  return { ...chats, [chatId]: { ...chat, ...updater(chat) } }
}

interface ChatStore {
  chats: Record<string, ChatState>
  activeChatId: string | null

  initChat(chatId: string): void
  appendStreamText(chatId: string, text: string): void
  setProcessing(chatId: string, isProcessing: boolean): void
  addToolUse(chatId: string, tool: ToolUseItem): void
  setDocumentStatus(chatId: string, documentId: string, filename: string, status: 'parsing' | 'parsed' | 'failed', error?: string): void
  completeMessage(chatId: string, fullText: string, toolUse: ToolUseItem[]): void
  addUserMessage(chatId: string, message: Message): void
  setMessages(chatId: string, messages: Message[]): void
  handleError(chatId: string, error: string, errorCode?: string): void
  removeChat(chatId: string): void
  setShowInsufficientCredits(chatId: string, show: boolean): void
  markSseErrorHandled(chatId: string): void
  resetSseErrorHandled(chatId: string): void
  setActiveChatId(chatId: string | null): void
}

export const useChatStore = create<ChatStore>((set) => ({
  chats: {},
  activeChatId: null,

  initChat: (chatId) =>
    set((state) => {
      if (state.chats[chatId]) return state
      return { chats: { ...state.chats, [chatId]: defaultChatState(chatId) } }
    }),

  appendStreamText: (chatId, text) =>
    set((state) => ({
      chats: updateChat(state.chats, chatId, (chat) => ({
        streamingText: chat.streamingText + text,
        chatStatus: chat.isProcessing ? 'streaming' : chat.chatStatus,
      })),
    })),

  setProcessing: (chatId, isProcessing) =>
    set((state) => ({
      chats: updateChat(state.chats, chatId, () => {
        if (isProcessing) {
          return { isProcessing: true, chatStatus: 'submitted' as const }
        }
        return {
          isProcessing: false,
          streamingText: '',
          pendingToolUse: [],
          chatStatus: 'ready' as const,
        }
      }),
    })),

  addToolUse: (chatId, tool) =>
    set((state) => ({
      chats: updateChat(state.chats, chatId, (chat) => {
        const updated = chat.pendingToolUse.map((t) =>
          t.status === 'running' ? { ...t, status: 'done' as const } : t,
        )
        return { pendingToolUse: [...updated, tool] }
      }),
    })),

  setDocumentStatus: (chatId, documentId, filename, status, error) =>
    set((state) => ({
      chats: updateChat(state.chats, chatId, (chat) => {
        const nextStatuses = { ...chat.documentStatuses }
        if (status !== 'parsing') {
          for (const [key, value] of Object.entries(nextStatuses)) {
            if (key.endsWith(':pending') && value.filename === filename) {
              delete nextStatuses[key]
            }
          }
        }
        nextStatuses[documentId === 'pending' ? `${filename}:pending` : documentId] = {
          filename,
          status,
          error,
        }
        return { documentStatuses: nextStatuses }
      }),
    })),

  completeMessage: (chatId, fullText, toolUse) => {
    set((state) => ({
      chats: updateChat(state.chats, chatId, () => ({
        messages: [
          ...(state.chats[chatId]?.messages ?? []),
          {
            id: Date.now().toString(),
            role: 'assistant' as const,
            content: fullText,
            timestamp: new Date().toISOString(),
            toolUse: toolUse.length > 0 ? toolUse : undefined,
          },
        ],
        streamingText: '',
        pendingToolUse: [],
      })),
    }))
    // Notify after state is committed
    queueMicrotask(notifyChatUpdate)
  },

  addUserMessage: (chatId, message) => {
    set((state) => ({
      chats: updateChat(state.chats, chatId, (chat) => ({
        messages: [...chat.messages, message],
      })),
    }))
    // Notify after state is committed
    queueMicrotask(notifyChatUpdate)
  },

  setMessages: (chatId, messages) =>
    set((state) => ({
      chats: updateChat(state.chats, chatId, () => ({ messages })),
    })),

  handleError: (chatId, error, errorCode) =>
    set((state) => {
      const isCredits = errorCode === 'INSUFFICIENT_CREDITS'
      const chat = state.chats[chatId]
      if (!chat) return state

      let messages = chat.messages
      if (isCredits) {
        // Replace last assistant message if it was just added
        const last = messages[messages.length - 1]
        const base =
          last && last.role === 'assistant' && !last.errorCode
            ? messages.slice(0, -1)
            : messages
        messages = [
          ...base,
          {
            id: Date.now().toString(),
            role: 'assistant' as const,
            content: '',
            timestamp: new Date().toISOString(),
            errorCode: 'INSUFFICIENT_CREDITS',
          },
        ]
      } else if (error) {
        messages = [
          ...messages,
          {
            id: Date.now().toString(),
            role: 'assistant' as const,
            content: `⚠️ ${error}`,
            timestamp: new Date().toISOString(),
          },
        ]
      }

      // Reset error status after 2 seconds
      setTimeout(() => {
        set((s) => ({
          chats: updateChat(s.chats, chatId, (c) => ({
            chatStatus: c.chatStatus === 'error' ? ('ready' as const) : c.chatStatus,
          })),
        }))
      }, 2000)

      return {
        chats: {
          ...state.chats,
          [chatId]: {
            ...chat,
            messages,
            streamingText: '',
            isProcessing: false,
            pendingToolUse: [],
            chatStatus: 'error' as const,
            sseErrorHandled: true,
            showInsufficientCredits: isCredits ? true : chat.showInsufficientCredits,
          },
        },
      }
    }),

  removeChat: (chatId) =>
    set((state) => {
      const { [chatId]: _, ...rest } = state.chats
      return {
        chats: rest,
        activeChatId: state.activeChatId === chatId ? null : state.activeChatId,
      }
    }),

  setShowInsufficientCredits: (chatId, show) =>
    set((state) => ({
      chats: updateChat(state.chats, chatId, () => ({
        showInsufficientCredits: show,
      })),
    })),

  markSseErrorHandled: (chatId) =>
    set((state) => ({
      chats: updateChat(state.chats, chatId, () => ({
        sseErrorHandled: true,
      })),
    })),

  resetSseErrorHandled: (chatId) =>
    set((state) => ({
      chats: updateChat(state.chats, chatId, () => ({
        sseErrorHandled: false,
      })),
    })),

  setActiveChatId: (chatId) => set({ activeChatId: chatId }),
}))
