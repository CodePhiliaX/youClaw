import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLogger } from '../logger/index.ts'
import { getPaths } from '../config/index.ts'
import type { BrowserManager } from './manager.ts'
import { getChatBrowserState, upsertChatBrowserState } from './store.ts'
import { resolveCdpHttpBase } from './chrome.ts'
import { withNoProxyForCdpUrl } from './cdp-proxy-bypass.ts'

type NodeAction =
  | 'open_tab'
  | 'navigate'
  | 'snapshot'
  | 'screenshot'
  | 'click'
  | 'type'
  | 'press_key'
  | 'close_tab'

type NodePayload = {
  endpoint: string
  action: NodeAction
  activePageUrl?: string | null
  url?: string
  selector?: string
  text?: string
  key?: string
  path?: string
}

type NodeResult = {
  url?: string
  title?: string
  text?: string
  path?: string
  closed?: boolean
}

function findNodeExecutable(): string {
  if (!process.versions.bun && process.execPath) {
    return process.execPath
  }
  return 'node'
}

function resolvePlaywrightRunnerScriptPath(): string {
  const rootCandidate = resolve(getPaths().root, 'src', 'browser', 'playwright-runner.js')
  if (existsSync(rootCandidate)) {
    return rootCandidate
  }

  const resourcesDir = process.env.RESOURCES_DIR?.trim()
  if (resourcesDir) {
    const bundledCandidates = [
      resolve(resourcesDir, '_up_', 'src', 'browser', 'playwright-runner.js'),
      resolve(resourcesDir, 'src', 'browser', 'playwright-runner.js'),
    ]
    for (const candidate of bundledCandidates) {
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }

  throw new Error('Bundled browser helper script not found')
}

async function runNodePlaywrightAction(payload: NodePayload): Promise<NodeResult> {
  const logger = getLogger()
  const nodePath = findNodeExecutable()
  const scriptPath = resolvePlaywrightRunnerScriptPath()

  return withNoProxyForCdpUrl(payload.endpoint, async () =>
    new Promise<NodeResult>((resolvePromise, rejectPromise) => {
      const child = spawn(nodePath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk)
      })
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk)
      })
      child.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          rejectPromise(new Error(`Node.js executable not found: ${nodePath}. Browser helper requires Node.js 18+ in PATH`))
          return
        }
        rejectPromise(err)
      })
      child.on('close', (code) => {
        if (code !== 0) {
          rejectPromise(new Error(stderr.trim() || stdout.trim() || `Node browser helper exited with code ${code}`))
          return
        }

        try {
          resolvePromise(stdout ? JSON.parse(stdout) as NodeResult : {})
        } catch (err) {
          logger.error({ stdout, stderr, err, category: 'browser' }, 'Failed to parse Node browser helper output')
          rejectPromise(err)
        }
      })

      child.stdin.write(JSON.stringify(payload))
      child.stdin.end()
    }),
  )
}

function resolveEndpoint(browserManager: BrowserManager, profileId: string): string {
  const profile = browserManager.getProfile(profileId)
  if (!profile) {
    throw new Error('Browser profile not found')
  }

  return profile.runtime?.wsEndpoint ?? profile.cdpUrl ?? resolveCdpHttpBase(profile)
}

async function ensureEndpoint(browserManager: BrowserManager, profileId: string): Promise<string> {
  const runtime = await browserManager.startProfile(profileId)
  const profile = browserManager.getProfile(profileId)
  if (!profile) {
    throw new Error('Browser profile not found')
  }
  return runtime.wsEndpoint ?? profile.cdpUrl ?? resolveCdpHttpBase(profile)
}

async function persistChatPage(chatId: string, agentId: string, profileId: string, result: NodeResult): Promise<void> {
  upsertChatBrowserState(chatId, {
    agentId,
    profileId,
    activeTargetId: null,
    activePageUrl: result.url ?? null,
    activePageTitle: result.title ?? null,
  })
}

function getActivePageUrl(chatId: string, profileId: string): string | null {
  const state = getChatBrowserState(chatId)
  if (!state || state.profileId !== profileId) return null
  return state.activePageUrl
}

export async function openTabForChat(
  browserManager: BrowserManager,
  params: { chatId: string; agentId: string; profileId: string; url?: string },
): Promise<{ url: string; title: string }> {
  const endpoint = await ensureEndpoint(browserManager, params.profileId)
  const result = await runNodePlaywrightAction({
    endpoint,
    action: 'open_tab',
    url: params.url,
    activePageUrl: getActivePageUrl(params.chatId, params.profileId),
  })
  await persistChatPage(params.chatId, params.agentId, params.profileId, result)
  return {
    url: result.url ?? '',
    title: result.title ?? '',
  }
}

export async function navigateForChat(
  browserManager: BrowserManager,
  params: { chatId: string; agentId: string; profileId: string; url: string },
): Promise<{ url: string; title: string }> {
  const endpoint = await ensureEndpoint(browserManager, params.profileId)
  const result = await runNodePlaywrightAction({
    endpoint,
    action: 'navigate',
    url: params.url,
    activePageUrl: getActivePageUrl(params.chatId, params.profileId),
  })
  await persistChatPage(params.chatId, params.agentId, params.profileId, result)
  return {
    url: result.url ?? '',
    title: result.title ?? '',
  }
}

export async function snapshotForChat(
  browserManager: BrowserManager,
  params: { chatId: string; agentId: string; profileId: string },
): Promise<Record<string, unknown>> {
  const endpoint = await ensureEndpoint(browserManager, params.profileId)
  const result = await runNodePlaywrightAction({
    endpoint,
    action: 'snapshot',
    activePageUrl: getActivePageUrl(params.chatId, params.profileId),
  })
  await persistChatPage(params.chatId, params.agentId, params.profileId, result)
  return {
    title: result.title ?? '',
    url: result.url ?? '',
    text: result.text ?? '',
  }
}

export async function screenshotForChat(
  browserManager: BrowserManager,
  params: { chatId: string; agentId: string; profileId: string; path: string },
): Promise<{ path: string; url: string }> {
  const endpoint = await ensureEndpoint(browserManager, params.profileId)
  const result = await runNodePlaywrightAction({
    endpoint,
    action: 'screenshot',
    path: params.path,
    activePageUrl: getActivePageUrl(params.chatId, params.profileId),
  })
  await persistChatPage(params.chatId, params.agentId, params.profileId, result)
  return {
    path: result.path ?? params.path,
    url: result.url ?? '',
  }
}

export async function clickForChat(
  browserManager: BrowserManager,
  params: { chatId: string; agentId: string; profileId: string; selector: string },
): Promise<{ url: string; title: string }> {
  const endpoint = await ensureEndpoint(browserManager, params.profileId)
  const result = await runNodePlaywrightAction({
    endpoint,
    action: 'click',
    selector: params.selector,
    activePageUrl: getActivePageUrl(params.chatId, params.profileId),
  })
  await persistChatPage(params.chatId, params.agentId, params.profileId, result)
  return {
    url: result.url ?? '',
    title: result.title ?? '',
  }
}

export async function typeForChat(
  browserManager: BrowserManager,
  params: { chatId: string; agentId: string; profileId: string; selector: string; text: string },
): Promise<{ url: string; title: string }> {
  const endpoint = await ensureEndpoint(browserManager, params.profileId)
  const result = await runNodePlaywrightAction({
    endpoint,
    action: 'type',
    selector: params.selector,
    text: params.text,
    activePageUrl: getActivePageUrl(params.chatId, params.profileId),
  })
  await persistChatPage(params.chatId, params.agentId, params.profileId, result)
  return {
    url: result.url ?? '',
    title: result.title ?? '',
  }
}

export async function pressKeyForChat(
  browserManager: BrowserManager,
  params: { chatId: string; agentId: string; profileId: string; key: string },
): Promise<{ url: string; title: string }> {
  const endpoint = await ensureEndpoint(browserManager, params.profileId)
  const result = await runNodePlaywrightAction({
    endpoint,
    action: 'press_key',
    key: params.key,
    activePageUrl: getActivePageUrl(params.chatId, params.profileId),
  })
  await persistChatPage(params.chatId, params.agentId, params.profileId, result)
  return {
    url: result.url ?? '',
    title: result.title ?? '',
  }
}

export async function closeTabForChat(
  browserManager: BrowserManager,
  params: { chatId: string; agentId: string; profileId: string; url?: string },
): Promise<{ closed: boolean }> {
  const endpoint = await ensureEndpoint(browserManager, params.profileId)
  const result = await runNodePlaywrightAction({
    endpoint,
    action: 'close_tab',
    url: params.url,
    activePageUrl: getActivePageUrl(params.chatId, params.profileId),
  })

  if (!result.closed) {
    return { closed: false }
  }

  await persistChatPage(params.chatId, params.agentId, params.profileId, result)
  return { closed: true }
}

export async function disconnectAllBrowserSessions(): Promise<void> {
  return
}

export async function probeBrowserActionPath(
  browserManager: BrowserManager,
  params: { profileId: string; chatId: string; agentId: string },
): Promise<string> {
  const endpoint = resolveEndpoint(browserManager, params.profileId)
  const result = await runNodePlaywrightAction({
    endpoint,
    action: 'snapshot',
    activePageUrl: getActivePageUrl(params.chatId, params.profileId),
  })
  return result.url ?? ''
}
