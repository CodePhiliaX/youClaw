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
      const url = new URL(`${apiUrl}/api/credit/transactions`)
      const limit = c.req.query('limit')
      if (limit) url.searchParams.set('limit', limit)

      const res = await fetch(url.toString(), {
        headers: { rdxtoken: token },
      })

      if (!res.ok) {
        return c.json({ error: 'Failed to fetch transactions' }, 500)
      }

      const data = await res.json() as { success?: boolean; data?: unknown }
      return c.json(data.data ?? [])
    } catch (err) {
      const logger = getLogger()
      logger.error({ error: String(err), category: 'credit' }, 'Failed to fetch credit transactions')
      return c.json({ error: 'Failed to fetch transactions' }, 500)
    }
  })

  // POST /invitation/redeem — redeem invitation/activation code
  app.post('/invitation/redeem', async (c) => {
    const apiUrl = getEnv().YOUCLAW_API_URL
    if (!apiUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }
    const token = getAuthToken()
    if (!token) {
      return c.json({ error: 'Not logged in' }, 401)
    }

    try {
      const body = await c.req.json() as { code?: string }
      const code = body.code
      if (!code) {
        return c.json({ error: 'Code is required' }, 400)
      }

      // Java backend uses @RequestParam, so pass via query params
      const url = new URL(`${apiUrl}/api/invitation/redeem`)
      url.searchParams.set('code', code)

      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { rdxtoken: token },
      })

      if (!res.ok) {
        const text = await res.text()
        const logger = getLogger()
        logger.error({ status: res.status, body: text, category: 'invitation' }, 'Failed to redeem code')
        return c.json({ error: 'Failed to redeem code' }, res.status as any)
      }

      const data = await res.json() as { success?: boolean; errorCode?: string; errorMessage?: string }
      // Java backend may return 200 with success: false
      if (data.success === false) {
        return c.json({ error: data.errorCode || data.errorMessage || 'Failed to redeem code' }, 400)
      }
      return c.json(data)
    } catch (err) {
      const logger = getLogger()
      logger.error({ error: String(err), category: 'invitation' }, 'Failed to redeem invitation code')
      return c.json({ error: 'Failed to redeem code' }, 500)
    }
  })

  // GET /invitation/referral_code — get current user's referral code
  app.get('/invitation/referral_code', async (c) => {
    const apiUrl = getEnv().YOUCLAW_API_URL
    if (!apiUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }
    const token = getAuthToken()
    if (!token) {
      return c.json({ error: 'Not logged in' }, 401)
    }

    const logger = getLogger()
    try {
      const targetUrl = `${apiUrl}/api/invitation/referral_code`
      logger.info({ targetUrl, category: 'invitation' }, 'Fetching referral code')

      const res = await fetch(targetUrl, {
        headers: { rdxtoken: token },
      })

      const text = await res.text()
      logger.info({ status: res.status, body: text.substring(0, 500), category: 'invitation' }, 'Referral code response')

      if (!res.ok) {
        return c.json({ error: `Upstream error: ${res.status}`, detail: text.substring(0, 200) }, 500)
      }

      const data = JSON.parse(text) as { success?: boolean; data?: unknown }
      return c.json(data.data ?? null)
    } catch (err) {
      logger.error({ error: String(err), category: 'invitation' }, 'Failed to fetch referral code')
      return c.json({ error: 'Failed to fetch referral code', detail: String(err) }, 500)
    }
  })

  // GET /invitation/referral_stats — get current user's referral statistics
  app.get('/invitation/referral_stats', async (c) => {
    const apiUrl = getEnv().YOUCLAW_API_URL
    if (!apiUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }
    const token = getAuthToken()
    if (!token) {
      return c.json({ error: 'Not logged in' }, 401)
    }

    const logger = getLogger()
    try {
      const targetUrl = `${apiUrl}/api/invitation/referral_stats`
      logger.info({ targetUrl, category: 'invitation' }, 'Fetching referral stats')

      const res = await fetch(targetUrl, {
        headers: { rdxtoken: token },
      })

      const text = await res.text()
      logger.info({ status: res.status, body: text.substring(0, 500), category: 'invitation' }, 'Referral stats response')

      if (!res.ok) {
        return c.json({ error: `Upstream error: ${res.status}`, detail: text.substring(0, 200) }, 500)
      }

      const data = JSON.parse(text) as { success?: boolean; data?: unknown }
      return c.json(data.data ?? {})
    } catch (err) {
      logger.error({ error: String(err), category: 'invitation' }, 'Failed to fetch referral stats')
      return c.json({ error: 'Failed to fetch referral stats', detail: String(err) }, 500)
    }
  })

  return app
}
