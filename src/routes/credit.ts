import { Hono } from 'hono'
import { getAuthToken } from './auth.ts'
import { getLogger } from '../logger/index.ts'
import { getEnv } from '../config/index.ts'

export function createCreditRoutes() {
  const app = new Hono()

  // GET /credit/balance — query credit balance
  app.get('/credit/balance', async (c) => {
    const apiUrl = getEnv().YOUCLAW_API_URL
    if (!apiUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }
    const token = getAuthToken()
    if (!token) {
      return c.json({ error: 'Not logged in' }, 401)
    }

    try {
      const res = await fetch(`${apiUrl}/api/credit/balance`, {
        headers: { rdxtoken: token },
      })

      if (!res.ok) {
        return c.json({ error: 'Failed to fetch balance' }, 500)
      }

      const data = await res.json() as { success?: boolean; data?: { balance?: number } }
      const balance = data.data?.balance ?? 0
      return c.json({ balance })
    } catch (err) {
      const logger = getLogger()
      logger.error({ error: String(err), category: 'credit' }, 'Failed to fetch credit balance')
      return c.json({ error: 'Failed to fetch balance' }, 500)
    }
  })

  // GET /credit/transactions — query credit transactions
  app.get('/credit/transactions', async (c) => {
    const apiUrl = getEnv().YOUCLAW_API_URL
    if (!apiUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }
    const token = getAuthToken()
    if (!token) {
      return c.json({ error: 'Not logged in' }, 401)
    }

    try {
      // Forward pagination params
      const url = new URL(`${apiUrl}/api/credit/transactions`)
      const page = c.req.query('page')
      const limit = c.req.query('limit')
      if (page) url.searchParams.set('page', page)
      if (limit) url.searchParams.set('limit', limit)

      const res = await fetch(url.toString(), {
        headers: { rdxtoken: token },
      })

      if (!res.ok) {
        return c.json({ error: 'Failed to fetch transactions' }, 500)
      }

      const data = await res.json() as { success?: boolean; data?: unknown }
      return c.json(data.data ?? { items: [], total: 0 })
    } catch (err) {
      const logger = getLogger()
      logger.error({ error: String(err), category: 'credit' }, 'Failed to fetch credit transactions')
      return c.json({ error: 'Failed to fetch transactions' }, 500)
    }
  })

  return app
}
