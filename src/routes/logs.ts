import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getLogDates, readLogEntries } from '../logger/reader.ts'
import { logBroadcaster } from '../logger/broadcaster.ts'

export function createLogsRoutes() {
  const app = new Hono()

  app.get('/logs', (c) => c.json(getLogDates()))

  // SSE endpoint — must be registered before /logs/:date to avoid "stream" matching as date param
  app.get('/logs/stream', (c) => {
    return streamSSE(c, async (sse) => {
      let writeQueue = Promise.resolve()
      const enqueueWrite = (data: string) => {
        writeQueue = writeQueue.then(() => sse.writeSSE({ event: 'log', data })).catch(() => {})
      }

      const unsubscribe = logBroadcaster.subscribe((entry) => {
        enqueueWrite(JSON.stringify(entry))
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

  // ?level=warn&category=agent&search=xxx&offset=0&limit=100&order=desc
  app.get('/logs/:date', async (c) => {
    const date = c.req.param('date')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: 'Invalid date format' }, 400)
    }
    const result = await readLogEntries(date, {
      level: c.req.query('level') || undefined,
      category: c.req.query('category') || undefined,
      search: c.req.query('search') || undefined,
      offset: parseInt(c.req.query('offset') ?? '0', 10),
      limit: Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500),
      order: (c.req.query('order') as 'asc' | 'desc') || undefined,
    })
    return c.json(result)
  })

  return app
}
