import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDatabase } from '../db/index.ts'
import { getPaths } from '../config/index.ts'
import type {
  BrowserProfile,
  BrowserProfileRecord,
  BrowserProfileRuntime,
  BrowserProfileRuntimePatch,
  BrowserProfileRuntimeRecord,
  BrowserRuntimeStatus,
  ChatBrowserState,
  ChatBrowserStatePatch,
  ChatBrowserStateRecord,
  CreateBrowserProfileInput,
  UpdateBrowserProfileInput,
} from './types.ts'
import {
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_PROFILE_NAME,
} from './types.ts'

function parseLaunchArgs(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function normalizeRuntime(record: BrowserProfileRuntimeRecord | null): BrowserProfileRuntime | null {
  if (!record) return null
  return {
    status: record.status,
    pid: record.pid,
    wsEndpoint: record.ws_endpoint,
    lastError: record.last_error,
    lastStartedAt: record.last_started_at,
    heartbeatAt: record.heartbeat_at,
  }
}

function normalizeProfile(record: BrowserProfileRecord, runtime: BrowserProfileRuntimeRecord | null): BrowserProfile {
  const fallbackManagedDir = record.driver === 'managed'
    ? resolve(getPaths().browserProfiles, record.id)
    : null

  return {
    id: record.id,
    name: record.name,
    driver: record.driver,
    isDefault: record.is_default === 1,
    executablePath: record.executable_path,
    userDataDir: record.user_data_dir ?? fallbackManagedDir,
    cdpPort: record.cdp_port,
    cdpUrl: record.cdp_url,
    headless: record.headless === 1,
    noSandbox: record.no_sandbox === 1,
    attachOnly: record.attach_only === 1,
    launchArgs: parseLaunchArgs(record.launch_args_json),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    runtime: normalizeRuntime(runtime),
  }
}

function normalizeChatState(record: ChatBrowserStateRecord): ChatBrowserState {
  return {
    chatId: record.chat_id,
    agentId: record.agent_id,
    profileId: record.profile_id,
    activeTargetId: record.active_target_id,
    activePageUrl: record.active_page_url,
    activePageTitle: record.active_page_title,
    updatedAt: record.updated_at,
  }
}

function getProfileRuntimeRecord(profileId: string): BrowserProfileRuntimeRecord | null {
  const db = getDatabase()
  const row = db.query('SELECT * FROM browser_profile_runtime WHERE profile_id = ?').get(profileId)
  return (row as BrowserProfileRuntimeRecord) ?? null
}

function resolveManagedUserDataDir(id: string): string {
  const dir = resolve(getPaths().browserProfiles, id)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function ensureDefaultManagedProfile(): BrowserProfile {
  const existing = getBrowserProfile(DEFAULT_BROWSER_PROFILE_ID)
  const userDataDir = resolveManagedUserDataDir(DEFAULT_BROWSER_PROFILE_ID)

  if (!existing) {
    return createBrowserProfile({
      id: DEFAULT_BROWSER_PROFILE_ID,
      name: DEFAULT_BROWSER_PROFILE_NAME,
      driver: 'managed',
      isDefault: true,
      userDataDir,
    })
  }

  if (!existing.isDefault || !existing.userDataDir) {
    return updateBrowserProfile(DEFAULT_BROWSER_PROFILE_ID, {
      isDefault: true,
      userDataDir: existing.userDataDir ?? userDataDir,
    }) ?? existing
  }

  return existing
}

export function listBrowserProfiles(): BrowserProfile[] {
  const db = getDatabase()
  const rows = db.query(`
    SELECT
      p.*,
      r.profile_id AS runtime_profile_id,
      r.status AS runtime_status,
      r.pid AS runtime_pid,
      r.ws_endpoint AS runtime_ws_endpoint,
      r.last_error AS runtime_last_error,
      r.last_started_at AS runtime_last_started_at,
      r.heartbeat_at AS runtime_heartbeat_at
    FROM browser_profiles p
    LEFT JOIN browser_profile_runtime r ON r.profile_id = p.id
    ORDER BY p.is_default DESC, p.created_at DESC
  `).all() as Array<BrowserProfileRecord & {
    runtime_profile_id: string | null
    runtime_status: string | null
    runtime_pid: number | null
    runtime_ws_endpoint: string | null
    runtime_last_error: string | null
    runtime_last_started_at: string | null
    runtime_heartbeat_at: string | null
  }>

  return rows.map((row) => {
    const runtime = row.runtime_profile_id
      ? {
          profile_id: row.runtime_profile_id,
          status: (row.runtime_status ?? 'stopped') as BrowserRuntimeStatus,
          pid: row.runtime_pid,
          ws_endpoint: row.runtime_ws_endpoint,
          last_error: row.runtime_last_error,
          last_started_at: row.runtime_last_started_at,
          heartbeat_at: row.runtime_heartbeat_at,
        }
      : null

    return normalizeProfile(row, runtime)
  })
}

export function getBrowserProfile(id: string): BrowserProfile | null {
  const db = getDatabase()
  const row = db.query('SELECT * FROM browser_profiles WHERE id = ?').get(id)
  if (!row) return null
  return normalizeProfile(row as BrowserProfileRecord, getProfileRuntimeRecord(id))
}

export function createBrowserProfile(input: CreateBrowserProfileInput): BrowserProfile {
  const db = getDatabase()
  const now = new Date().toISOString()
  const id = input.id ?? crypto.randomUUID().slice(0, 8)
  const driver = input.driver ?? 'managed'
  const userDataDir = input.userDataDir ?? (driver === 'managed' ? resolveManagedUserDataDir(id) : null)

  if (input.isDefault) {
    db.run('UPDATE browser_profiles SET is_default = 0')
  }

  db.run(
    `INSERT INTO browser_profiles (
      id, name, driver, is_default, executable_path, user_data_dir, cdp_port, cdp_url,
      headless, no_sandbox, attach_only, launch_args_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      driver,
      input.isDefault ? 1 : 0,
      input.executablePath ?? null,
      userDataDir,
      input.cdpPort ?? null,
      input.cdpUrl ?? null,
      input.headless ? 1 : 0,
      input.noSandbox ? 1 : 0,
      input.attachOnly ? 1 : 0,
      JSON.stringify(input.launchArgs ?? []),
      now,
      now,
    ],
  )

  return getBrowserProfile(id)!
}

export function updateBrowserProfile(id: string, patch: UpdateBrowserProfileInput): BrowserProfile | null {
  const db = getDatabase()
  const existing = getBrowserProfile(id)
  if (!existing) return null

  if (patch.isDefault) {
    db.run('UPDATE browser_profiles SET is_default = 0')
  }

  const fields: string[] = []
  const values: Array<string | number | null> = []

  if (patch.name !== undefined) {
    fields.push('name = ?')
    values.push(patch.name)
  }
  if (patch.driver !== undefined) {
    fields.push('driver = ?')
    values.push(patch.driver)
  }
  if (patch.executablePath !== undefined) {
    fields.push('executable_path = ?')
    values.push(patch.executablePath)
  }
  if (patch.userDataDir !== undefined) {
    fields.push('user_data_dir = ?')
    values.push(patch.userDataDir)
  }
  if (patch.cdpPort !== undefined) {
    fields.push('cdp_port = ?')
    values.push(patch.cdpPort)
  }
  if (patch.cdpUrl !== undefined) {
    fields.push('cdp_url = ?')
    values.push(patch.cdpUrl)
  }
  if (patch.headless !== undefined) {
    fields.push('headless = ?')
    values.push(patch.headless ? 1 : 0)
  }
  if (patch.noSandbox !== undefined) {
    fields.push('no_sandbox = ?')
    values.push(patch.noSandbox ? 1 : 0)
  }
  if (patch.attachOnly !== undefined) {
    fields.push('attach_only = ?')
    values.push(patch.attachOnly ? 1 : 0)
  }
  if (patch.launchArgs !== undefined) {
    fields.push('launch_args_json = ?')
    values.push(JSON.stringify(patch.launchArgs))
  }
  if (patch.isDefault !== undefined) {
    fields.push('is_default = ?')
    values.push(patch.isDefault ? 1 : 0)
  }

  fields.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)

  db.run(`UPDATE browser_profiles SET ${fields.join(', ')} WHERE id = ?`, values)
  return getBrowserProfile(id)
}

export function deleteBrowserProfile(id: string): void {
  const db = getDatabase()
  db.run('DELETE FROM browser_profile_runtime WHERE profile_id = ?', [id])
  db.run('DELETE FROM chat_browser_state WHERE profile_id = ?', [id])
  db.run('DELETE FROM browser_profiles WHERE id = ?', [id])
}

export function upsertBrowserProfileRuntime(profileId: string, patch: BrowserProfileRuntimePatch): BrowserProfileRuntime {
  const db = getDatabase()
  const now = new Date().toISOString()
  const current = getProfileRuntimeRecord(profileId)
  const next: BrowserProfileRuntimeRecord = {
    profile_id: profileId,
    status: patch.status ?? current?.status ?? 'stopped',
    pid: patch.pid ?? current?.pid ?? null,
    ws_endpoint: patch.wsEndpoint ?? current?.ws_endpoint ?? null,
    last_error: patch.lastError ?? current?.last_error ?? null,
    last_started_at: patch.lastStartedAt ?? current?.last_started_at ?? null,
    heartbeat_at: patch.heartbeatAt ?? now,
  }

  db.run(
    `INSERT INTO browser_profile_runtime (
      profile_id, status, pid, ws_endpoint, last_error, last_started_at, heartbeat_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      status = excluded.status,
      pid = excluded.pid,
      ws_endpoint = excluded.ws_endpoint,
      last_error = excluded.last_error,
      last_started_at = excluded.last_started_at,
      heartbeat_at = excluded.heartbeat_at`,
    [
      next.profile_id,
      next.status,
      next.pid,
      next.ws_endpoint,
      next.last_error,
      next.last_started_at,
      next.heartbeat_at,
    ],
  )

  return normalizeRuntime(getProfileRuntimeRecord(profileId))!
}

export function getBrowserProfileRuntime(profileId: string): BrowserProfileRuntime | null {
  return normalizeRuntime(getProfileRuntimeRecord(profileId))
}

export function clearBrowserProfileRuntime(profileId: string): void {
  const db = getDatabase()
  db.run('DELETE FROM browser_profile_runtime WHERE profile_id = ?', [profileId])
}

export function getChatBrowserState(chatId: string): ChatBrowserState | null {
  const db = getDatabase()
  const row = db.query('SELECT * FROM chat_browser_state WHERE chat_id = ?').get(chatId)
  return row ? normalizeChatState(row as ChatBrowserStateRecord) : null
}

export function upsertChatBrowserState(chatId: string, patch: ChatBrowserStatePatch & { agentId: string; profileId: string }): ChatBrowserState {
  const db = getDatabase()
  const current = getChatBrowserState(chatId)
  const next: ChatBrowserStateRecord = {
    chat_id: chatId,
    agent_id: patch.agentId ?? current?.agentId ?? 'default',
    profile_id: patch.profileId ?? current?.profileId ?? DEFAULT_BROWSER_PROFILE_ID,
    active_target_id: patch.activeTargetId ?? current?.activeTargetId ?? null,
    active_page_url: patch.activePageUrl ?? current?.activePageUrl ?? null,
    active_page_title: patch.activePageTitle ?? current?.activePageTitle ?? null,
    updated_at: new Date().toISOString(),
  }

  db.run(
    `INSERT INTO chat_browser_state (
      chat_id, agent_id, profile_id, active_target_id, active_page_url, active_page_title, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      agent_id = excluded.agent_id,
      profile_id = excluded.profile_id,
      active_target_id = excluded.active_target_id,
      active_page_url = excluded.active_page_url,
      active_page_title = excluded.active_page_title,
      updated_at = excluded.updated_at`,
    [
      next.chat_id,
      next.agent_id,
      next.profile_id,
      next.active_target_id,
      next.active_page_url,
      next.active_page_title,
      next.updated_at,
    ],
  )

  return getChatBrowserState(chatId)!
}

export function clearChatBrowserState(chatId: string): void {
  const db = getDatabase()
  db.run('DELETE FROM chat_browser_state WHERE chat_id = ?', [chatId])
}
