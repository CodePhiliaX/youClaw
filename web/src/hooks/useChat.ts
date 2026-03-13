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
  toolUse?: ToolUseItem[]  // 新增
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

  const { close: closeSSE } = useSSE(chatId, (event) => {
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
        // 显示错误信息给用户，而不是静默吞掉
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

  useEffect(() => {
    if (chatStatus === 'error') return // 保持 error 状态直到 setTimeout 重置
    if (isProcessing && !streamingText) setChatStatus('submitted')
    else if (isProcessing && streamingText) setChatStatus('streaming')
    else setChatStatus('ready')
  }, [isProcessing, streamingText, chatStatus])

  const send = useCallback(async (prompt: string, browserProfileId?: string, attachments?: Attachment[]) => {    // 添加用户消息到列表
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
      // 请求失败时显示错误并重置状态
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
    setChatId(existingChatId)
    const msgs = await getMessages(existingChatId)
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
