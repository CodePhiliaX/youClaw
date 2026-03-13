import { Hono } from 'hono'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import {
  createBrowserProfile,
  getBrowserProfiles,
  getBrowserProfile,
  deleteBrowserProfile,
} from '../db/index.ts'
import { getLogger } from '../logger/index.ts'

export function createBrowserProfilesRoutes() {
  const app = new Hono()

  // 列出所有 Profile
  app.get('/browser-profiles', (c) => {
    const profiles = getBrowserProfiles()
    return c.json(profiles)
  })

  // 创建 Profile
  app.post('/browser-profiles', async (c) => {
    const body = await c.req.json<{ name: string }>()
    if (!body.name) {
      return c.json({ error: 'name is required' }, 400)
    }
    const id = crypto.randomUUID().slice(0, 8)
    createBrowserProfile({ id, name: body.name })
    // 创建 userDataDir
    const profileDir = resolve(getPaths().browserProfiles, id)
    mkdirSync(profileDir, { recursive: true })
    return c.json(getBrowserProfile(id), 201)
  })

  // 删除 Profile
  app.delete('/browser-profiles/:id', (c) => {
    const id = c.req.param('id')
    const profile = getBrowserProfile(id)
    if (!profile) {
      return c.json({ error: 'not found' }, 404)
    }
    deleteBrowserProfile(id)
    // 删除 userDataDir
    const profileDir = resolve(getPaths().browserProfiles, id)
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {}
    return c.json({ ok: true })
  })

  // 启动 headed 浏览器
  app.post('/browser-profiles/:id/launch', async (c) => {
    const log = getLogger()
    const id = c.req.param('id')
    const profile = getBrowserProfile(id)
    if (!profile) {
      return c.json({ error: 'not found' }, 404)
    }
    const profileDir = resolve(getPaths().browserProfiles, id)
    mkdirSync(profileDir, { recursive: true })

    // 先关闭该 profile 对应的 session（幂等操作），确保新参数生效
    log.info({ profileId: id }, 'closing existing session before launch')
    await launchAndVerify(['--session', id, 'close'], 10_000).catch(() => {})

    // 启动 headed 浏览器，使用独立 session 避免 daemon 参数被忽略
    log.info({ profileId: id, profileDir }, 'launching headed browser')
    const result = await launchAndVerify(
      ['--session', id, '--profile', profileDir, '--headed', 'open', 'about:blank'],
      15_000,
    )

    if (result.ok) {
      log.info({ profileId: id }, 'browser launched successfully')
      return c.json({ ok: true, profileDir })
    } else {
      log.error({ profileId: id, error: result.error }, 'browser launch failed')
      return c.json({ error: result.error }, 500)
    }
  })

  return app
}

/** 封装 spawn agent-browser + 等待退出的逻辑 */
function launchAndVerify(
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('agent-browser', args, { stdio: 'pipe' })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill()
        resolve({ ok: false, error: `launch timeout after ${timeoutMs}ms` })
      }
    }, timeoutMs)

    child.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ ok: false, error: err.message })
      }
    })

    child.on('close', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        if (code === 0) {
          resolve({ ok: true })
        } else {
          const detail = stderr.trim() || stdout.trim() || `exit code ${code}`
          resolve({ ok: false, error: detail })
        }
      }
    })
  })
}
