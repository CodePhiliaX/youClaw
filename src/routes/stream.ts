import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { EventBus } from '../events/index.ts'

export function createStreamRoutes(eventBus: EventBus) {
  const stream = new Hono()

  // GET /api/stream/system — subscribe to system-level events
  // IMPORTANT: must be registered before :chatId to avoid being matched as chatId="system"
  stream.get('/stream/system', (c) => {
    return streamSSE(c, async (sse) => {
      let writeQueue = Promise.resolve()
      const enqueueWrite = (event: string, data: string) => {
        writeQueue = writeQueue.then(() => sse.writeSSE({ event, data })).catch(() => {})
      }

      const unsubscribe = eventBus.subscribe({}, (event) => {
        enqueueWrite(event.type, JSON.stringify(event))
      })

      await sse.writeSSE({
        event: 'connected',
        data: JSON.stringify({ timestamp: new Date().toISOString() }),
      })

      try {
        await new Promise<void>((resolve) => {
          c.req.raw.signal.addEventListener('abort', () => resolve())
        })
      } finally {
        unsubscribe()
      }
    })
  })

  // GET /api/stream/:chatId — subscribe to streaming events for a chat
  stream.get('/stream/:chatId', (c) => {
    const chatId = c.req.param('chatId')

    return streamSSE(c, async (sse) => {
      // Use a write queue to ensure SSE events are sent in order and prevent concurrent write loss
      let writeQueue = Promise.resolve()
      const enqueueWrite = (event: string, data: string) => {
        writeQueue = writeQueue.then(() => sse.writeSSE({ event, data })).catch(() => {})
      }

      const unsubscribe = eventBus.subscribe({ chatId }, (event) => {
        enqueueWrite(event.type, JSON.stringify(event))
      })

      // Send connection confirmation
      await sse.writeSSE({
        event: 'connected',
        data: JSON.stringify({ chatId, timestamp: new Date().toISOString() }),
      })

      // Keep connection open until client disconnects
      try {
        // Wait for abort signal
        await new Promise<void>((resolve) => {
          c.req.raw.signal.addEventListener('abort', () => resolve())
        })
      } finally {
        unsubscribe()
      }
    })
  })

  return stream
}
