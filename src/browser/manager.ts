import { type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { getLogger } from '../logger/index.ts'
import { getPaths } from '../config/index.ts'
import type { AgentManager } from '../agent/index.ts'
import { disconnectAllBrowserSessions } from './pw-session.ts'
import {
  createBrowserProfile,
  deleteBrowserProfile,
  ensureDefaultManagedProfile,
  getBrowserProfile,
  getBrowserProfileRuntime,
  listBrowserProfiles,
  updateBrowserProfile,
  upsertBrowserProfileRuntime,
} from './store.ts'
import {
  detectChromeExecutable,
  findAvailablePort,
  probeCdpVersion,
  requestCdpJson,
  spawnManagedChrome,
  waitForCdpReady,
} from './chrome.ts'
import {
  assertBrowserRelayToken,
  clearBrowserRelayConnection,
  deleteBrowserRelayProfile,
  getBrowserRelayCdpUrl,
  getBrowserRelayState,
  normalizeLoopbackCdpUrl,
  rotateBrowserRelayToken,
  setBrowserRelayConnection,
  type BrowserRelayState,
} from './relay.ts'
import type { BrowserProfile, BrowserProfileRuntime, CreateBrowserProfileInput, UpdateBrowserProfileInput } from './types.ts'

type ProfileTab = {
  id: string
  title?: string
  url?: string
  type?: string
}

export class BrowserManager {
  private readonly logger = getLogger()
  private readonly managedProcesses = new Map<string, ChildProcess>()
  private readonly startPromises = new Map<string, Promise<BrowserProfileRuntime>>()

  constructor(private readonly agentManager?: AgentManager) {}

  ensureDefaultProfile(): BrowserProfile {
    return ensureDefaultManagedProfile()
  }

  listProfiles(): BrowserProfile[] {
    return listBrowserProfiles()
  }

  getProfile(id: string): BrowserProfile | null {
    return getBrowserProfile(id)
  }

  getRelayState(id: string): BrowserRelayState {
    const profile = getBrowserProfile(id)
    if (!profile) throw new Error('Browser profile not found')
    if (profile.driver !== 'extension-relay') {
      throw new Error('Browser profile does not use the extension-relay driver')
    }
    return getBrowserRelayState(id)
  }

  createProfile(input: CreateBrowserProfileInput): BrowserProfile {
    return createBrowserProfile(input)
  }

  resolveProfileSelection(overrideProfileId?: string, agentDefaultProfileId?: string): BrowserProfile {
    if (overrideProfileId) {
      const override = getBrowserProfile(overrideProfileId)
      if (override) return override
    }

    if (agentDefaultProfileId) {
      const fallback = getBrowserProfile(agentDefaultProfileId)
      if (fallback) return fallback
    }

    return this.ensureDefaultProfile()
  }

  updateProfile(id: string, patch: UpdateBrowserProfileInput): BrowserProfile | null {
    return updateBrowserProfile(id, patch)
  }

  async deleteProfile(id: string): Promise<{ deleted: boolean; updatedAgents: string[] }> {
    const profile = getBrowserProfile(id)
    if (!profile) return { deleted: false, updatedAgents: [] }

    await this.stopProfile(id).catch(() => {})
    deleteBrowserProfile(id)
    deleteBrowserRelayProfile(id)

    if (profile.driver === 'managed' && profile.userDataDir && this.isManagedDataDir(profile.userDataDir)) {
      try {
        rmSync(profile.userDataDir, { recursive: true, force: true })
      } catch {}
    }

    const updatedAgents = this.clearAgentBrowserProfileBindings(id)
    if (updatedAgents.length > 0 && this.agentManager) {
      await this.agentManager.reloadAgents()
    }

    return { deleted: true, updatedAgents }
  }

  async startProfile(id: string): Promise<BrowserProfileRuntime> {
    const current = this.startPromises.get(id)
    if (current) return current

    const task = this.startProfileInternal(id).finally(() => {
      this.startPromises.delete(id)
    })
    this.startPromises.set(id, task)
    return task
  }

  async restartProfile(id: string): Promise<BrowserProfileRuntime> {
    const profile = getBrowserProfile(id)
    if (profile?.driver === 'extension-relay') {
      return this.getProfileStatus(id)
    }
    await this.stopProfile(id)
    return this.startProfile(id)
  }

  async stopProfile(id: string): Promise<BrowserProfileRuntime> {
    const profile = getBrowserProfile(id)
    if (!profile) {
      throw new Error('Browser profile not found')
    }

    if (profile.driver === 'extension-relay') {
      return (await this.disconnectRelay(id)).runtime
    }

    const child = this.managedProcesses.get(id)
    if (child && child.pid) {
      try {
        child.kill('SIGTERM')
      } catch {}
      this.managedProcesses.delete(id)
    } else if (profile.driver === 'managed') {
      const runtime = getBrowserProfileRuntime(id)
      if (runtime?.pid) {
        try {
          process.kill(runtime.pid, 'SIGTERM')
        } catch {}
      }
    }

    return upsertBrowserProfileRuntime(id, {
      status: 'stopped',
      pid: null,
      wsEndpoint: null,
      lastError: null,
      heartbeatAt: new Date().toISOString(),
    })
  }

  async getProfileStatus(id: string): Promise<BrowserProfileRuntime> {
    const profile = getBrowserProfile(id)
    if (!profile) throw new Error('Browser profile not found')
    return this.reconcileProfileRuntime(profile)
  }

  async connectRelay(id: string, token: string, cdpUrl: string): Promise<{ relay: BrowserRelayState; runtime: BrowserProfileRuntime }> {
    const profile = getBrowserProfile(id)
    if (!profile) throw new Error('Browser profile not found')
    if (profile.driver !== 'extension-relay') {
      throw new Error('Browser profile does not use the extension-relay driver')
    }

    assertBrowserRelayToken(id, token)
    const normalizedCdpUrl = normalizeLoopbackCdpUrl(cdpUrl)
    const activeProfile = {
      ...profile,
      cdpUrl: normalizedCdpUrl,
    }
    const meta = await this.probeProfileMetadata(activeProfile)
    const now = new Date().toISOString()
    const relay = setBrowserRelayConnection(id, normalizedCdpUrl)
    const runtime = upsertBrowserProfileRuntime(id, {
      status: 'running',
      pid: null,
      wsEndpoint: meta.webSocketDebuggerUrl,
      lastError: null,
      lastStartedAt: now,
      heartbeatAt: now,
    })

    return { relay, runtime }
  }

  async disconnectRelay(id: string): Promise<{ relay: BrowserRelayState; runtime: BrowserProfileRuntime }> {
    const profile = getBrowserProfile(id)
    if (!profile) throw new Error('Browser profile not found')
    if (profile.driver !== 'extension-relay') {
      throw new Error('Browser profile does not use the extension-relay driver')
    }

    const relay = clearBrowserRelayConnection(id)
    const runtime = upsertBrowserProfileRuntime(id, {
      status: 'stopped',
      pid: null,
      wsEndpoint: null,
      lastError: null,
      heartbeatAt: new Date().toISOString(),
    })

    return { relay, runtime }
  }

  async rotateRelayToken(id: string): Promise<{ relay: BrowserRelayState; runtime: BrowserProfileRuntime }> {
    const profile = getBrowserProfile(id)
    if (!profile) throw new Error('Browser profile not found')
    if (profile.driver !== 'extension-relay') {
      throw new Error('Browser profile does not use the extension-relay driver')
    }

    const relay = rotateBrowserRelayToken(id)
    const runtime = upsertBrowserProfileRuntime(id, {
      status: 'stopped',
      pid: null,
      wsEndpoint: null,
      lastError: null,
      heartbeatAt: new Date().toISOString(),
    })

    return { relay, runtime }
  }

  async listTabs(id: string): Promise<ProfileTab[]> {
    const profile = getBrowserProfile(id)
    if (!profile) throw new Error('Browser profile not found')
    await this.reconcileProfileRuntime(profile)
    const activeProfile = this.resolveRuntimeProfile(profile)
    if (!activeProfile.cdpUrl && !activeProfile.cdpPort) {
      throw new Error('Extension relay is not connected')
    }
    const tabs = await this.requestTabs(activeProfile)
    return tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      type: tab.type,
    }))
  }

  async probeProfile(id: string): Promise<BrowserProfileRuntime> {
    const profile = getBrowserProfile(id)
    if (!profile) throw new Error('Browser profile not found')
    const activeProfile = this.resolveRuntimeProfile(profile)
    if (!activeProfile.cdpUrl && !activeProfile.cdpPort) {
      return upsertBrowserProfileRuntime(id, {
        status: 'stopped',
        pid: null,
        wsEndpoint: null,
        lastError: null,
        heartbeatAt: new Date().toISOString(),
      })
    }
    const meta = await this.probeProfileMetadata(activeProfile)
    return upsertBrowserProfileRuntime(id, {
      status: 'running',
      wsEndpoint: meta.webSocketDebuggerUrl,
      lastError: null,
      heartbeatAt: new Date().toISOString(),
    })
  }

  async shutdown(): Promise<void> {
    await disconnectAllBrowserSessions()
    const profiles = listBrowserProfiles().filter((profile) => profile.driver === 'managed')
    for (const profile of profiles) {
      await this.stopProfile(profile.id).catch(() => {})
    }
  }

  private async startProfileInternal(id: string): Promise<BrowserProfileRuntime> {
    const profile = getBrowserProfile(id)
    if (!profile) {
      throw new Error('Browser profile not found')
    }

    if (profile.driver === 'remote-cdp') {
      return this.probeProfile(id)
    }

    if (profile.driver === 'extension-relay') {
      return this.reconcileProfileRuntime(profile)
    }

    const reconciled = await this.reconcileProfileRuntime(profile)
    if (reconciled.status === 'running') {
      return reconciled
    }

    const cdpPort = profile.cdpPort ?? await findAvailablePort()
    const executablePath = profile.executablePath ?? detectChromeExecutable()
    if (!executablePath) {
      return upsertBrowserProfileRuntime(id, {
        status: 'error',
        lastError: 'Chrome executable not found',
        heartbeatAt: new Date().toISOString(),
      })
    }

    const nextProfile = updateBrowserProfile(id, {
      cdpPort,
      executablePath,
      userDataDir: profile.userDataDir ?? resolve(getPaths().browserProfiles, id),
    })
    if (!nextProfile) {
      throw new Error('Failed to persist browser profile configuration')
    }

    upsertBrowserProfileRuntime(id, {
      status: 'starting',
      pid: null,
      wsEndpoint: null,
      lastError: null,
      lastStartedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    })

    let child: ChildProcess | null = null
    try {
      const launched = spawnManagedChrome(nextProfile)
      child = launched.child
      this.managedProcesses.set(id, child)
      this.attachLifecycle(id, child)
      child.stderr?.on('data', (chunk: Buffer | string) => {
        const text = String(chunk).trim()
        if (text) {
          this.logger.warn({ profileId: id, stderr: text.slice(0, 1000), category: 'browser' }, 'Managed browser stderr')
        }
      })

      const meta = await waitForCdpReady(nextProfile)
      return upsertBrowserProfileRuntime(id, {
        status: 'running',
        pid: child.pid ?? null,
        wsEndpoint: meta.webSocketDebuggerUrl,
        lastError: null,
        lastStartedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      })
    } catch (err) {
      if (child) {
        try {
          child.kill('SIGTERM')
        } catch {}
      }
      const message = err instanceof Error ? err.message : String(err)
      return upsertBrowserProfileRuntime(id, {
        status: 'error',
        pid: null,
        wsEndpoint: null,
        lastError: message,
        heartbeatAt: new Date().toISOString(),
      })
    }
  }

  private async reconcileProfileRuntime(profile: BrowserProfile): Promise<BrowserProfileRuntime> {
    const runtime = getBrowserProfileRuntime(profile.id)
    if (profile.driver === 'extension-relay') {
      const activeProfile = this.resolveRuntimeProfile(profile)
      if (!activeProfile.cdpUrl) {
        return upsertBrowserProfileRuntime(profile.id, {
          status: 'stopped',
          pid: null,
          wsEndpoint: null,
          lastError: null,
          heartbeatAt: new Date().toISOString(),
        })
      }
    }

    try {
      const activeProfile = this.resolveRuntimeProfile(profile)
      const meta = await this.probeProfileMetadata(activeProfile)
      return upsertBrowserProfileRuntime(profile.id, {
        status: 'running',
        wsEndpoint: meta.webSocketDebuggerUrl,
        lastError: null,
        heartbeatAt: new Date().toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (runtime?.status === 'starting') {
        return runtime
      }
      const next = upsertBrowserProfileRuntime(profile.id, {
        status: runtime?.lastStartedAt ? 'error' : 'stopped',
        pid: null,
        wsEndpoint: null,
        lastError: runtime?.lastStartedAt ? message : null,
        heartbeatAt: new Date().toISOString(),
      })
      if (next.status !== 'running') {
        this.managedProcesses.delete(profile.id)
      }
      return next
    }
  }

  protected async probeProfileMetadata(profile: BrowserProfile): Promise<{ webSocketDebuggerUrl: string | null; browser: string | null }> {
    return probeCdpVersion(profile)
  }

  protected async requestTabs(profile: BrowserProfile): Promise<Array<{ id: string; title?: string; url?: string; type?: string }>> {
    return requestCdpJson<Array<{ id: string; title?: string; url?: string; type?: string }>>(profile, '/json/list')
  }

  private resolveRuntimeProfile(profile: BrowserProfile): BrowserProfile {
    if (profile.driver !== 'extension-relay') return profile

    const relayCdpUrl = getBrowserRelayCdpUrl(profile.id)
    if (!relayCdpUrl) return profile

    return {
      ...profile,
      cdpUrl: relayCdpUrl,
    }
  }

  private attachLifecycle(profileId: string, child: ChildProcess): void {
    child.once('exit', async (code, signal) => {
      this.managedProcesses.delete(profileId)
      const profile = getBrowserProfile(profileId)
      if (profile) {
        try {
          const meta = await probeCdpVersion(profile)
          upsertBrowserProfileRuntime(profileId, {
            status: 'running',
            pid: null,
            wsEndpoint: meta.webSocketDebuggerUrl,
            lastError: null,
            heartbeatAt: new Date().toISOString(),
          })
          this.logger.info({ profileId, code, signal, category: 'browser' }, 'Browser launcher exited but CDP endpoint remains reachable')
          return
        } catch {}
      }

      const message = code === 0 || signal === 'SIGTERM'
        ? null
        : `browser exited unexpectedly${code !== null ? ` (code ${code})` : ''}${signal ? ` (${signal})` : ''}`
      upsertBrowserProfileRuntime(profileId, {
        status: message ? 'error' : 'stopped',
        pid: null,
        wsEndpoint: null,
        lastError: message,
        heartbeatAt: new Date().toISOString(),
      })
      this.logger.info({ profileId, code, signal, category: 'browser' }, 'Managed browser process exited')
    })
  }

  private isManagedDataDir(userDataDir: string): boolean {
    const managedRoot = resolve(getPaths().browserProfiles)
    return userDataDir === managedRoot || userDataDir.startsWith(`${managedRoot}/`)
  }

  private clearAgentBrowserProfileBindings(profileId: string): string[] {
    if (!this.agentManager) return []

    const updatedAgents: string[] = []
    for (const agent of this.agentManager.getAgents()) {
      const configuredProfileId = agent.browser?.defaultProfile ?? agent.browserProfile
      if (configuredProfileId === profileId) {
        updatedAgents.push(agent.id)
      }
    }

    if (updatedAgents.length === 0) return []

    const agentsDir = getPaths().agents
    for (const agentId of updatedAgents) {
      const configPath = resolve(agentsDir, agentId, 'agent.yaml')
      if (!existsSync(configPath)) continue
      try {
        const raw = readFileSync(configPath, 'utf-8')
        const config = parseYaml(raw) as Record<string, unknown> | null
        if (!config) continue

        const browserSection = config.browser as Record<string, unknown> | undefined
        const matchesLegacy = config.browserProfile === profileId
        const matchesStructured = browserSection?.defaultProfile === profileId
        if (!matchesLegacy && !matchesStructured) continue

        if (matchesLegacy) {
          delete config.browserProfile
        }
        if (matchesStructured && browserSection) {
          delete browserSection.defaultProfile
          if (Object.keys(browserSection).length === 0) {
            delete config.browser
          }
        }
        writeFileSync(configPath, stringifyYaml(config))
      } catch {}
    }

    return updatedAgents
  }
}
