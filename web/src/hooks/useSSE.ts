import { useEffect, useRef, useCallback } from 'react'
import { getBaseUrlSync } from '@/api/transport'

type SSEEvent = {
  type: string
  agentId: string
  chatId: string
  text?: string
  fullText?: string
  error?: string
  isProcessing?: boolean
  tool?: string
  input?: string
}

export function useSSE(chatId: string | null, onEvent: (event: SSEEvent) => void) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!chatId) return

    const baseUrl = getBaseUrlSync()
    const es = new EventSource(`${baseUrl}/api/stream/${encodeURIComponent(chatId)}`)
    eventSourceRef.current = es

    const handleEvent = (e: Event) => {
      try {
        const me = e as MessageEvent
        const data = JSON.parse(me.data) as SSEEvent
        onEventRef.current(data)
      } catch {}
    }

    es.addEventListener('stream', handleEvent)
    es.addEventListener('complete', handleEvent)
    es.addEventListener('error', handleEvent)
    es.addEventListener('processing', handleEvent)
    es.addEventListener('tool_use', handleEvent)

    es.onerror = () => {
      // Auto-reconnect handled by EventSource
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [chatId])

  const close = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
  }, [])

  return { close }
}
