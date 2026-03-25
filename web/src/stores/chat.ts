import { create } from 'zustand'
import type { Attachment } from '../types/attachment'

export type ToolUseItem = {
  id: string
  name: string
  input?: string
  status: 'running' | 'done'
}

export type TimelineItem =
  | {
    id: string
    kind: 'message'
    role: 'user' | 'assistant'
    content: string
    timestamp: string
    toolUse?: ToolUseItem[]
    attachments?: Attachment[]
    errorCode?: string
  }
  | {
    id: string
    kind: 'assistant_stream'
    content: string
    timestamp: string
  }
  | {
    id: string
    kind: 'tool_use'
    name: string
    input?: string
    status: 'running' | 'done'
    timestamp: string
  }
  | {
    id: string
    kind: 'document_status'
    documentKey: string
    filename: string
    status: 'parsing' | 'parsed' | 'failed'
    error?: string
    timestamp: string
  }

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolUse?: ToolUseItem[]
  attachments?: Attachment[]
  errorCode?: string
  sessionId?: string
}

export interface ChatState {
  chatId: string
  messages: Message[]
  timelineItems: TimelineItem[]
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

function messageToTimelineItem(message: Message): TimelineItem {
  return {
    id: `message:${message.id}`,
    kind: 'message',
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    toolUse: message.toolUse,
    attachments: message.attachments,
    errorCode: message.errorCode,
  }
}

function buildTimelineFromMessages(messages: Message[]): TimelineItem[] {
  return messages.map(messageToTimelineItem)
}

function defaultChatState(chatId: string): ChatState {
  return {
    chatId,
    messages: [],
    timelineItems: [],
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
  completeMessage(chatId: string, fullText: string, toolUse: ToolUseItem[], sessionId?: string): void
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
        timelineItems: (() => {
          const timestamp = new Date().toISOString()
          const normalizedItems = chat.timelineItems.map((item) =>
            item.kind === 'tool_use' && item.status === 'running'
              ? { ...item, status: 'done' as const }
              : item,
          )
          const lastItem = normalizedItems[normalizedItems.length - 1]

          if (lastItem?.kind === 'assistant_stream') {
            return [
              ...normalizedItems.slice(0, -1),
              {
                ...lastItem,
                content: lastItem.content + text,
              },
            ]
          }

          return [
            ...normalizedItems,
            {
              id: `assistant_stream:${timestamp}:${crypto.randomUUID()}`,
              kind: 'assistant_stream',
              content: text,
              timestamp,
            },
          ]
        })(),
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
        const timelineItems = chat.timelineItems.map((item) =>
          item.kind === 'tool_use' && item.status === 'running'
            ? { ...item, status: 'done' as const }
            : item,
        )
        const updated = chat.pendingToolUse.map((t) =>
          t.status === 'running' ? { ...t, status: 'done' as const } : t,
        )
        return {
          pendingToolUse: [...updated, tool],
          timelineItems: [
            ...timelineItems,
            {
              id: `tool:${tool.id}`,
              kind: 'tool_use',
              name: tool.name,
              input: tool.input,
              status: tool.status,
              timestamp: new Date().toISOString(),
            },
          ],
        }
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
        const documentKey = documentId === 'pending' ? `${filename}:pending` : documentId
        const timelineItems = [...chat.timelineItems]
        const existingIndex = timelineItems.findIndex((item) =>
          item.kind === 'document_status'
          && (
            item.documentKey === documentKey
            || (item.documentKey === `${filename}:pending` && item.filename === filename)
          )
        )

        const nextItem: TimelineItem = {
          id: existingIndex >= 0
            ? timelineItems[existingIndex]!.id
            : `document:${documentKey}:${Date.now()}`,
          kind: 'document_status',
          documentKey,
          filename,
          status,
          error,
          timestamp: existingIndex >= 0
            ? timelineItems[existingIndex]!.timestamp
            : new Date().toISOString(),
        }

        if (existingIndex >= 0) {
          timelineItems[existingIndex] = nextItem
        } else {
          timelineItems.push(nextItem)
        }

        return {
          documentStatuses: nextStatuses,
          timelineItems,
        }
      }),
    })),

  completeMessage: (chatId, fullText, toolUse, sessionId) => {
    set((state) => ({
      chats: updateChat(state.chats, chatId, (chat) => {
        // Idempotency: skip if a message with this sessionId already exists
        if (sessionId && chat.messages.some(m => m.sessionId === sessionId)) {
          return {}
        }
        const timestamp = new Date().toISOString()
        const nextMessage: Message = {
          id: sessionId ?? Date.now().toString(),
          role: 'assistant' as const,
          content: fullText,
          timestamp,
          toolUse: toolUse.length > 0 ? toolUse : undefined,
          sessionId,
        }
        const messages = [...chat.messages, nextMessage]

        return {
          messages,
          // Switch completed turns to the canonical persisted message form so the
          // live view matches a refreshed chat and avoids incomplete stream artifacts.
          timelineItems: buildTimelineFromMessages(messages),
          streamingText: '',
          pendingToolUse: [],
        }
      }),
    }))
    // Notify after state is committed
    queueMicrotask(notifyChatUpdate)
  },

  addUserMessage: (chatId, message) => {
    set((state) => {
      const chat = state.chats[chatId]
      if (!chat || chat.messages.some((existing) => existing.id === message.id)) {
        return state
      }

      return {
        chats: {
          ...state.chats,
          [chatId]: {
            ...chat,
            messages: [...chat.messages, message],
            timelineItems: [...chat.timelineItems, messageToTimelineItem(message)],
          },
        },
      }
    })
    // Notify after state is committed
    queueMicrotask(notifyChatUpdate)
  },

  setMessages: (chatId, messages) =>
    set((state) => ({
      chats: updateChat(state.chats, chatId, () => ({
        messages,
        timelineItems: buildTimelineFromMessages(messages),
      })),
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

      const errorTimelineItems = buildTimelineFromMessages(messages)

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
            timelineItems: errorTimelineItems,
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
      const rest = { ...state.chats }
      delete rest[chatId]
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
