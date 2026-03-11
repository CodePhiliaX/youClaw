import { Hono } from 'hono'
import { getLogDates, readLogEntries } from '../logger/reader.ts'

export function createLogsRoutes() {
  const app = new Hono()

  app.get('/logs', (c) => c.json(getLogDates()))

  // ?level=warn&category=agent&search=xxx&offset=0&limit=100
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
    })
    return c.json(result)
  })

  return app
}
