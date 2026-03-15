import { Hono } from 'hono'
import type { RegistryManager } from '../skills/registry.ts'
import { getLogger } from '../logger/index.ts'

export function createRegistryRoutes(registryManager: RegistryManager) {
  const api = new Hono()

  // Get recommended skills list (with install status)
  api.get('/registry/recommended', (c) => {
    const recommended = registryManager.getRecommended()
    return c.json(recommended)
  })

  // Install a recommended skill
  api.post('/registry/install', async (c) => {
    const logger = getLogger()
    const body = await c.req.json<{ slug: string }>()
    const { slug } = body

    if (!slug) {
      return c.json({ error: 'Missing slug parameter' }, 400)
    }

    try {
      await registryManager.installSkill(slug)
      return c.json({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ slug, error: message }, 'Failed to install skill')
      return c.json({ ok: false, error: message }, 500)
    }
  })

  // Uninstall a skill
  api.post('/registry/uninstall', async (c) => {
    const logger = getLogger()
    const body = await c.req.json<{ slug: string }>()
    const { slug } = body

    if (!slug) {
      return c.json({ error: 'Missing slug parameter' }, 400)
    }

    try {
      await registryManager.uninstallSkill(slug)
      return c.json({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ slug, error: message }, 'Failed to uninstall skill')
      return c.json({ ok: false, error: message }, 500)
    }
  })

  return api
}
