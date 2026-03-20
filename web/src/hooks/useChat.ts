import { useCallback } from 'react'
import { sendMessage, getMessages, abortChat } from '../api/client'
import { useChatStore, onChatUpdate } from '../stores/chat'
import { sseManager } from '../lib/sse-manager'
import type { Attachment } from '../types/attachment'
import type { ChatState, Message, TimelineItem, ToolUseItem } from '../stores/chat'

// Re-export types for consumers (chatCtx.ts imports these)
export type { Message, TimelineItem, ToolUseItem }

/**
 * Read active chat's state. Returns null when no chat is active (new chat screen).
 */
export function useActiveChatState(): ChatState | null {
  const activeChatId = useChatStore((s) => s.activeChatId)
  const chat = useChatStore((s) =>
    activeChatId ? s.chats[activeChatId] ?? null : null,
  )
  return chat
}

/**
 * Read a specific chat's isProcessing status (for sidebar indicators).
 * Each component calling this only re-renders when its specific chatId changes.
 */
export function useChatProcessing(chatId: string): boolean {
  return useChatStore((s) => s.chats[chatId]?.isProcessing ?? false)
}

/**
 * Chat actions. agentId is captured here so send() matches existing ChatContextType.
 */
export function useChatActions(agentId: string) {
  const send = useCallback(
    async (
      prompt: string,
      browserProfileId?: string,
      attachments?: Attachment[],
    ) => {
      const store = useChatStore.getState()
      const currentChatId = store.activeChatId
      const effectiveChatId = currentChatId ?? `web:${crypto.randomUUID()}`

      // Initialize chat entry in store
      store.initChat(effectiveChatId)
      store.setActiveChatId(effectiveChatId)

      // Reset SSE error flag for this send
      store.resetSseErrorHandled(effectiveChatId)

      // Add user message
      store.addUserMessage(effectiveChatId, {
        id: Date.now().toString(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
        attachments,
      })

      // Set processing
      store.setProcessing(effectiveChatId, true)

      // Connect SSE
      sseManager.connect(effectiveChatId)

      // Wait for EventSource connection if new chat
      if (!currentChatId) {
        await new Promise((r) => setTimeout(r, 100))
      }

      try {
        await sendMessage(
          agentId,
          prompt,
          effectiveChatId,
          browserProfileId,
          attachments,
        )
      } catch (err) {
        // Check if SSE already handled error
        const latest = useChatStore.getState().chats[effectiveChatId]
        if (latest?.sseErrorHandled) {
          return
        }
        const errorMsg = err instanceof Error ? err.message : String(err)
        const isCredits =
          /insufficient|credit|balance|quota/i.test(errorMsg)
        const errorStore = useChatStore.getState()
        if (isCredits) {
          errorStore.setShowInsufficientCredits(effectiveChatId, true)
          errorStore.handleError(effectiveChatId, '', 'INSUFFICIENT_CREDITS')
        } else {
          errorStore.handleError(effectiveChatId, errorMsg)
        }
      }
    },
    [agentId],
  )

  const loadChat = useCallback(async (chatId: string) => {
    const store = useChatStore.getState()
    store.initChat(chatId)
    store.setActiveChatId(chatId)

    const existing = store.chats[chatId]
    if (existing?.isProcessing && !sseManager.isConnected(chatId)) {
      sseManager.connect(chatId)
    }

    const msgs = await getMessages(chatId)
    if (msgs.length === 0) {
      if (!existing || existing.messages.length === 0) {
        throw new Error('Chat not found or empty')
      }
      return
    }

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
  }, [])

  const newChat = useCallback(() => {
    useChatStore.getState().setActiveChatId(null)
  }, [])

  const stop = useCallback(() => {
    const store = useChatStore.getState()
    const chatId = store.activeChatId
    if (!chatId) return

    sseManager.disconnect(chatId)
    store.setProcessing(chatId, false)
    abortChat(chatId).catch(() => {})
  }, [])

  const setShowInsufficientCredits = useCallback((show: boolean) => {
    const store = useChatStore.getState()
    const chatId = store.activeChatId
    if (chatId) {
      store.setShowInsufficientCredits(chatId, show)
    }
  }, [])

  return { send, loadChat, newChat, stop, setShowInsufficientCredits }
}

// Re-export onChatUpdate for ChatProvider
export { onChatUpdate }
