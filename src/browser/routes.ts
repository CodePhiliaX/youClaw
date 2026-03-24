import { Hono } from 'hono'
import { z } from 'zod/v4'
import type { AgentManager } from '../agent/index.ts'
import type { BrowserManager } from './manager.ts'

const CreateProfileSchema = z.object({
  name: z.string().min(1),
  driver: z.enum(['managed', 'remote-cdp', 'extension-relay']).optional(),
  executablePath: z.string().nullable().optional(),
  userDataDir: z.string().nullable().optional(),
  cdpPort: z.number().int().nullable().optional(),
  cdpUrl: z.string().nullable().optional(),
  headless: z.boolean().optional(),
  noSandbox: z.boolean().optional(),
  attachOnly: z.boolean().optional(),
  launchArgs: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
})

const UpdateProfileSchema = CreateProfileSchema.partial().extend({
  name: z.string().min(1).optional(),
})

export function createBrowserRoutes(browserManager: BrowserManager, _agentManager?: AgentManager) {
  const app = new Hono()

  app.get('/browser/profiles', (c) => {
    return c.json(browserManager.listProfiles())
  })

  app.post('/browser/profiles', async (c) => {
    const parsed = CreateProfileSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400)
    }

    const profile = browserManager.createProfile(parsed.data)
    return c.json(profile, 201)
  })

  app.patch('/browser/profiles/:id', async (c) => {
    const parsed = UpdateProfileSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400)
    }

    const profile = browserManager.updateProfile(c.req.param('id'), parsed.data)
    if (!profile) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.json(profile)
  })

  app.delete('/browser/profiles/:id', async (c) => {
    const result = await browserManager.deleteProfile(c.req.param('id'))
    if (!result.deleted) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.json({ ok: true, updatedAgents: result.updatedAgents })
  })

  app.post('/browser/profiles/:id/start', async (c) => {
    try {
      const runtime = await browserManager.startProfile(c.req.param('id'))
      return c.json({ ok: true, runtime })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.post('/browser/profiles/:id/stop', async (c) => {
    try {
      const runtime = await browserManager.stopProfile(c.req.param('id'))
      return c.json({ ok: true, runtime })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.post('/browser/profiles/:id/restart', async (c) => {
    try {
      const runtime = await browserManager.restartProfile(c.req.param('id'))
      return c.json({ ok: true, runtime })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.get('/browser/profiles/:id/status', async (c) => {
    try {
      const runtime = await browserManager.getProfileStatus(c.req.param('id'))
      return c.json(runtime)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.get('/browser/profiles/:id/tabs', async (c) => {
    try {
      const tabs = await browserManager.listTabs(c.req.param('id'))
      return c.json({ tabs })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  app.post('/browser/profiles/:id/manual-login', async (c) => {
    try {
      const runtime = await browserManager.startProfile(c.req.param('id'))
      return c.json({
        ok: true,
        runtime,
        message: 'Open the browser window and log in manually. Login state is stored in the profile.',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  // Legacy compatibility routes
  app.get('/browser-profiles', (c) => {
    return c.json(browserManager.listProfiles())
  })

  app.post('/browser-profiles', async (c) => {
    const parsed = CreateProfileSchema.pick({ name: true }).safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: 'name is required' }, 400)
    }

    const profile = browserManager.createProfile({ name: parsed.data.name, driver: 'managed' })
    return c.json(profile, 201)
  })

  app.delete('/browser-profiles/:id', async (c) => {
    const result = await browserManager.deleteProfile(c.req.param('id'))
    if (!result.deleted) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.json({ ok: true })
  })

  app.post('/browser-profiles/:id/launch', async (c) => {
    try {
      const runtime = await browserManager.startProfile(c.req.param('id'))
      const profile = browserManager.getProfile(c.req.param('id'))
      return c.json({
        ok: true,
        profileDir: profile?.userDataDir,
        runtime,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  return app
}
