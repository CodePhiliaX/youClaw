import { useState, useCallback, useRef, useEffect } from 'react'
import { sendMessage, getMessages } from '../api/client'
import { useSSE } from './useSSE'
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
}

export function useChat(agentId: string) {
  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingToolUse, setPendingToolUse] = useState<ToolUseItem[]>([])
  const [chatStatus, setChatStatus] = useState<'submitted' | 'streaming' | 'ready' | 'error'>('ready')

  const pendingToolUseRef = useRef<ToolUseItem[]>([])
  useEffect(() => { pendingToolUseRef.current = pendingToolUse }, [pendingToolUse])

  // Track last SSE event time for timeout fallback
  const lastEventTimeRef = useRef<number>(0)

  const { close: closeSSE } = useSSE(chatId, (event) => {
    lastEventTimeRef.current = Date.now()
    switch (event.type) {
      case 'stream':
        setStreamingText(prev => prev + (event.text ?? ''))
        break
      case 'tool_use':
        setPendingToolUse(prev => {
          const updated = prev.map(t => t.status === 'running' ? { ...t, status: 'done' as const } : t)
          return [...updated, {
            id: Date.now().toString(),
            name: event.tool ?? 'unknown',
            input: event.input,
            status: 'running',
          }]
        })
        break
      case 'complete': {
        const finalToolUse = pendingToolUseRef.current.map(t => ({ ...t, status: 'done' as const }))
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: event.fullText ?? '',
          timestamp: new Date().toISOString(),
          toolUse: finalToolUse.length > 0 ? finalToolUse : undefined,
        }])
        setStreamingText('')
        setPendingToolUse([])
        break
      }
      case 'processing':
        setIsProcessing(event.isProcessing ?? false)
        break
      case 'error':
        setChatStatus('error')
        setTimeout(() => setChatStatus('ready'), 2000)
        // Show error to user instead of silently swallowing it
        if (event.error) {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'assistant',
            content: `⚠️ ${event.error}`,
            timestamp: new Date().toISOString(),
          }])
        }
        setStreamingText('')
        setIsProcessing(false)
        break
    }
  })

  // SSE fallback: proactively query backend when no event received for 8+ seconds while processing
  const chatIdRef = useRef(chatId)
  useEffect(() => { chatIdRef.current = chatId }, [chatId])

  useEffect(() => {
    if (!isProcessing) return
    const timer = setInterval(async () => {
      const cid = chatIdRef.current
      if (!cid) return
      // Over 8 seconds since last event, fetch proactively
      if (Date.now() - lastEventTimeRef.current < 8000) return
      try {
        const msgs = await getMessages(cid)
        const lastMsg = msgs[msgs.length - 1]
        if (lastMsg && lastMsg.is_bot_message) {
          // Backend has bot reply, meaning complete event was lost, recover manually
          setMessages(msgs.map(m => ({
            id: m.id,
            role: m.is_bot_message ? 'assistant' as const : 'user' as const,
            content: m.content,
            timestamp: m.timestamp,
            attachments: (m as { attachments?: Attachment[] | null }).attachments ?? undefined,
          })))
          setStreamingText('')
          setPendingToolUse([])
          setIsProcessing(false)
        }
      } catch {
        // Query failed, ignore and retry next time
      }
    }, 5000)
    return () => clearInterval(timer)
  }, [isProcessing])

  useEffect(() => {
    if (chatStatus === 'error') return // Keep error status until setTimeout resets it
    if (isProcessing && !streamingText) setChatStatus('submitted')
    else if (isProcessing && streamingText) setChatStatus('streaming')
    else setChatStatus('ready')
  }, [isProcessing, streamingText, chatStatus])

  const send = useCallback(async (prompt: string, browserProfileId?: string, attachments?: Attachment[]) => {    // Add user message to the list
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
      attachments,
    }])
    setIsProcessing(true)
    setStreamingText('')

    try {
      const result = await sendMessage(agentId, prompt, chatId ?? undefined, browserProfileId, attachments)
      if (!chatId) {
        setChatId(result.chatId)
      }
    } catch (err) {
      // Show error and reset state on request failure
      const errorMsg = err instanceof Error ? err.message : String(err)
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `⚠️ ${errorMsg}`,
        timestamp: new Date().toISOString(),
      }])
      setIsProcessing(false)
    }
  }, [agentId, chatId])

  const loadChat = useCallback(async (existingChatId: string) => {
    const msgs = await getMessages(existingChatId)
    if (msgs.length === 0) throw new Error('Chat not found or empty')
    setChatId(existingChatId)
    setMessages(msgs.map(m => ({
      id: m.id,
      role: m.is_bot_message ? 'assistant' as const : 'user' as const,
      content: m.content,
      timestamp: m.timestamp,
      attachments: (m as { attachments?: Attachment[] | null }).attachments ?? undefined,
    })))
  }, [])

  const newChat = useCallback(() => {
    setChatId(null)
    setMessages([])
    setStreamingText('')
    setIsProcessing(false)
    setPendingToolUse([])
  }, [])

  const stop = useCallback(() => {
    closeSSE()
    setIsProcessing(false)
    setStreamingText('')
    setPendingToolUse([])
  }, [closeSSE])

  return { chatId, messages, streamingText, isProcessing, pendingToolUse, chatStatus, send, loadChat, newChat, stop }
}
