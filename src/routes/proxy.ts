import { Hono } from 'hono'
import { getAuthToken } from './auth.ts'
import { getLogger } from '../logger/index.ts'
import { getEnv } from '../config/index.ts'

/**
 * Local proxy route: forwards SDK requests to cloud service with rdxtoken header.
 * In cloud mode ANTHROPIC_BASE_URL points to http://localhost:{port}/api/proxy.
 * SDK calls /api/proxy/v1/messages -> forwarded to cloud /api/v1/messages.
 */
export function createProxyRoutes() {
  const app = new Hono()

  // ALL /proxy/v1/messages — forward to cloud service
  app.all('/proxy/v1/messages', async (c) => {
    const apiUrl = getEnv().YOUCLAW_API_URL
    const logger = getLogger()

    if (!apiUrl) {
      return c.json({ error: 'Cloud service not configured' }, 501)
    }

    const token = getAuthToken()
    if (!token) {
      return c.json({ error: 'Not logged in, cannot proxy to cloud' }, 401)
    }

    const targetUrl = `${apiUrl}/api/v1/messages`

    try {
      // Pass-through request
      const headers: Record<string, string> = {
        rdxtoken: token,
      }

      // Forward Content-Type and other required headers
      const contentType = c.req.header('content-type')
      if (contentType) headers['content-type'] = contentType

      const accept = c.req.header('accept')
      if (accept) headers['accept'] = accept

      // Forward anthropic-related headers
      const anthropicVersion = c.req.header('anthropic-version')
      if (anthropicVersion) headers['anthropic-version'] = anthropicVersion

      const anthropicBeta = c.req.header('anthropic-beta')
      if (anthropicBeta) headers['anthropic-beta'] = anthropicBeta

      // Do not forward x-api-key (SDK sends 'youclaw'; readmex uses rdxtoken for auth)

      const body = c.req.method !== 'GET' ? await c.req.raw.clone().text() : undefined

      const res = await fetch(targetUrl, {
        method: c.req.method,
        headers,
        body,
      })

      // Pass-through streaming response
      if (res.headers.get('content-type')?.includes('text/event-stream')) {
        return new Response(res.body, {
          status: res.status,
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
          },
        })
      }

      // Regular JSON response
      const data = await res.text()
      return new Response(data, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/json',
        },
      })
    } catch (err) {
      logger.error({ error: String(err), category: 'proxy' }, 'Proxy to cloud service failed')
      return c.json({ error: 'Proxy request failed' }, 502)
    }
  })

  return app
}
