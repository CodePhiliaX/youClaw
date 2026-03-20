import { getBaseUrlSync } from '@/api/transport'
import { getMessages } from '@/api/client'
import { useChatStore } from '@/stores/chat'
import type { ToolUseItem } from '@/stores/chat'
import type { Attachment } from '@/types/attachment'

type SSEEvent = {
  type: string
  agentId: string
  chatId: string
  documentId?: string
  filename?: string
  status?: 'parsing' | 'parsed' | 'failed'
  text?: string
  fullText?: string
  error?: string
  errorCode?: string
  isProcessing?: boolean
  tool?: string
  input?: string
  // inbound_message fields
  messageId?: string
  content?: string
  senderName?: string
  timestamp?: string
  // new_chat fields
  name?: string
  channel?: string
}

class SSEManager {
  private connections = new Map<string, EventSource>()
  private lastEventTime = new Map<string, number>()
  private fallbackTimers = new Map<string, ReturnType<typeof setInterval>>()
  private systemEs: EventSource | null = null
  private onNewChatCallbacks = new Set<() => void>()

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.disconnectAll())
    }
  }

  /** Subscribe to new_chat events for chat list refresh */
  onNewChat(cb: () => void): () => void {
    this.onNewChatCallbacks.add(cb)
    return () => { this.onNewChatCallbacks.delete(cb) }
  }

  /** Connect to system-level SSE for global events (new_chat, inbound_message) */
  connectSystem(): void {
    if (this.systemEs) return
    const baseUrl = getBaseUrlSync()
    const es = new EventSource(`${baseUrl}/api/stream/system`)
    this.systemEs = es

    const handleSystemEvent = (e: Event) => {
      try {
        const me = e as MessageEvent
        const data = JSON.parse(me.data) as SSEEvent
        console.log('[SSE system]', data.type, data.chatId)
        if (data.type === 'new_chat') {
          for (const cb of this.onNewChatCallbacks) cb()
        } else if (data.type === 'inbound_message' && data.chatId && !this.connections.has(data.chatId)) {
          // Add the inbound user message to the active chat (external channels only)
          const store = useChatStore.getState()
          if (store.activeChatId === data.chatId) {
            store.initChat(data.chatId)
            store.addUserMessage(data.chatId, {
              id: data.messageId ?? Date.now().toString(),
              role: 'user' as const,
              content: data.content ?? '',
              timestamp: data.timestamp ?? new Date().toISOString(),
            })
          }
          // Also refresh chat list (updates last_message)
          for (const cb of this.onNewChatCallbacks) cb()
        } else if (data.chatId && !this.connections.has(data.chatId)) {
          // Route agent events for external channel chats (no Chat SSE connected)
          const store = useChatStore.getState()
          if (store.activeChatId === data.chatId) {
            if (data.type === 'processing' && data.isProcessing) {
              store.initChat(data.chatId)
            }
            this.handleSSEEvent(data.chatId, data)
          }
          if (data.type === 'complete') {
            // Refresh chat list regardless of active chat (updates last_message)
            for (const cb of this.onNewChatCallbacks) cb()
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    es.addEventListener('new_chat', handleSystemEvent)
    es.addEventListener('inbound_message', handleSystemEvent)
    es.addEventListener('processing', handleSystemEvent)
    es.addEventListener('stream', handleSystemEvent)
    es.addEventListener('tool_use', handleSystemEvent)
    es.addEventListener('complete', handleSystemEvent)
    es.addEventListener('error', handleSystemEvent)
    es.addEventListener('document_status', handleSystemEvent)
    es.onopen = () => {
      console.log('[SSE system] connected')
    }
    es.onerror = () => {
      console.log('[SSE system] error/reconnecting')
    }
  }

  disconnectSystem(): void {
    if (this.systemEs) {
      this.systemEs.close()
      this.systemEs = null
    }
  }

  connect(chatId: string): void {
    if (this.connections.has(chatId)) return

    const baseUrl = getBaseUrlSync()
    const es = new EventSource(
      `${baseUrl}/api/stream/${encodeURIComponent(chatId)}`,
    )
    this.connections.set(chatId, es)
    this.lastEventTime.set(chatId, Date.now())

    const handleEvent = (e: Event) => {
      try {
        const me = e as MessageEvent
        const data = JSON.parse(me.data) as SSEEvent
        this.lastEventTime.set(chatId, Date.now())
        this.handleSSEEvent(chatId, data)
      } catch {
        // Ignore parse errors
      }
    }

    es.addEventListener('stream', handleEvent)
    es.addEventListener('complete', handleEvent)
    es.addEventListener('error', handleEvent)
    es.addEventListener('processing', handleEvent)
    es.addEventListener('tool_use', handleEvent)
    es.addEventListener('document_status', handleEvent)

    es.onerror = () => {
      // Auto-reconnect handled by EventSource
    }

    // Start fallback timer: polls backend every 5s if no SSE event for 8s
    const timer = setInterval(async () => {
      const lastTime = this.lastEventTime.get(chatId) ?? 0
      if (Date.now() - lastTime < 8000) return

      const store = useChatStore.getState()
      const chat = store.chats[chatId]
      if (!chat?.isProcessing) return

      try {
        const msgs = await getMessages(chatId)
        const lastMsg = msgs[msgs.length - 1]
        if (lastMsg && lastMsg.is_bot_message) {
          store.setMessages(
            chatId,
            msgs.map((m) => ({
              id: m.id,
              role: m.is_bot_message
                ? ('assistant' as const)
                : ('user' as const),
              content: m.content,
              timestamp: m.timestamp,
              attachments:
                (m as { attachments?: Attachment[] | null }).attachments ??
                undefined,
            })),
          )
          store.setProcessing(chatId, false)
          this.disconnect(chatId)
        }
      } catch {
        // Query failed, retry next cycle
      }
    }, 5000)
    this.fallbackTimers.set(chatId, timer)
  }

  disconnect(chatId: string): void {
    const es = this.connections.get(chatId)
    if (es) {
      es.close()
      this.connections.delete(chatId)
    }
    const timer = this.fallbackTimers.get(chatId)
    if (timer) {
      clearInterval(timer)
      this.fallbackTimers.delete(chatId)
    }
    this.lastEventTime.delete(chatId)
  }

  disconnectAll(): void {
    for (const chatId of this.connections.keys()) {
      this.disconnect(chatId)
    }
    this.disconnectSystem()
  }

  isConnected(chatId: string): boolean {
    return this.connections.has(chatId)
  }

  private handleSSEEvent(chatId: string, event: SSEEvent): void {
    const store = useChatStore.getState()
    switch (event.type) {
      case 'stream':
        store.appendStreamText(chatId, event.text ?? '')
        break
      case 'tool_use': {
        const tool: ToolUseItem = {
          id: Date.now().toString(),
          name: event.tool ?? 'unknown',
          input: event.input,
          status: 'running',
        }
        store.addToolUse(chatId, tool)
        break
      }
      case 'document_status':
        if (event.documentId && event.filename && event.status) {
          store.setDocumentStatus(chatId, event.documentId, event.filename, event.status, event.error)
        }
        break
      case 'complete': {
        const chatState = store.chats[chatId]
        const finalToolUse = (chatState?.pendingToolUse ?? []).map((t) => ({
          ...t,
          status: 'done' as const,
        }))
        store.completeMessage(chatId, event.fullText ?? '', finalToolUse)
        break
      }
      case 'processing':
        store.setProcessing(chatId, event.isProcessing ?? false)
        if (!event.isProcessing) {
          this.disconnect(chatId)
        }
        break
      case 'error':
        store.markSseErrorHandled(chatId)
        store.handleError(chatId, event.error ?? '', event.errorCode)
        this.disconnect(chatId)
        break
    }
  }
}

// Singleton instance
export const sseManager = new SSEManager()
