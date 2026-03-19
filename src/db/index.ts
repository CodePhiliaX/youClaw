import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'

let _db: Database | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  sender TEXT,
  sender_name TEXT,
  content TEXT,
  timestamp TEXT NOT NULL,
  is_from_me INTEGER DEFAULT 0,
  is_bot_message INTEGER DEFAULT 0,
  PRIMARY KEY (id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_id, timestamp);

CREATE TABLE IF NOT EXISTS chats (
  chat_id TEXT PRIMARY KEY,
  name TEXT,
  agent_id TEXT,
  channel TEXT,
  is_group INTEGER DEFAULT 0,
  last_message_time TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  agent_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_file TEXT,
  PRIMARY KEY (agent_id, chat_id)
);

CREATE TABLE IF NOT EXISTS kv_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  next_run TEXT,
  last_run TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_runs ON task_run_logs(task_id, run_at);

CREATE TABLE IF NOT EXISTS browser_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

// bun:sqlite query result type helpers
type SQLValue = string | number | boolean | null
function queryAll<T>(db: Database, sql: string, ...params: SQLValue[]): T[] {
  return db.query(sql).all(...params) as T[]
}

function queryGet<T>(db: Database, sql: string, ...params: SQLValue[]): T | null {
  const row = db.query(sql).get(...params)
  return (row as T) ?? null
}

export function initDatabase(): Database {
  if (_db) return _db

  const paths = getPaths()
  mkdirSync(dirname(paths.db), { recursive: true })

  _db = new Database(paths.db)
  _db.exec('PRAGMA journal_mode = WAL')
  _db.exec('PRAGMA foreign_keys = ON')
  _db.exec(SCHEMA)

  // Migration: add name and description columns
  try { _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN name TEXT') } catch {}
  try { _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN description TEXT') } catch {}

  // Migration: add concurrency guard, backoff, timezone, and last result columns
  try { _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN running_since TEXT') } catch {}
  try { _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN consecutive_failures INTEGER DEFAULT 0') } catch {}
  try { _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN timezone TEXT') } catch {}
  try { _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN last_result TEXT') } catch {}

  // Migration: add delivery config columns
  try { _db.exec("ALTER TABLE scheduled_tasks ADD COLUMN delivery_mode TEXT DEFAULT 'none'") } catch {}
  try { _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN delivery_target TEXT') } catch {}

  // Migration: add delivery status column to run logs
  try { _db.exec('ALTER TABLE task_run_logs ADD COLUMN delivery_status TEXT') } catch {}

  // Migration: add attachments column
  try { _db.exec('ALTER TABLE messages ADD COLUMN attachments TEXT') } catch {}

  // Migration: add chat avatar column
  try { _db.exec('ALTER TABLE chats ADD COLUMN avatar TEXT') } catch {}

  // Migration: persist pi session file path for reliable resume
  try { _db.exec('ALTER TABLE sessions ADD COLUMN session_file TEXT') } catch {}

  getLogger().info({ path: paths.db }, 'Database initialized')
  return _db
}

export function getDatabase(): Database {
  if (!_db) throw new Error('Database not initialized')
  return _db
}

// ===== Message Operations =====

export function saveMessage(msg: {
  id: string
  chatId: string
  sender: string
  senderName: string
  content: string
  timestamp: string
  isFromMe: boolean
  isBotMessage: boolean
  attachments?: string
}) {
  const db = getDatabase()
  db.run(
    `INSERT OR REPLACE INTO messages (id, chat_id, sender, sender_name, content, timestamp, is_from_me, is_bot_message, attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [msg.id, msg.chatId, msg.sender, msg.senderName, msg.content, msg.timestamp, msg.isFromMe ? 1 : 0, msg.isBotMessage ? 1 : 0, msg.attachments ?? null]
  )
}

export function getMessages(chatId: string, limit = 50, before?: string): Array<{
  id: string; chat_id: string; sender: string; sender_name: string
  content: string; timestamp: string; is_from_me: number; is_bot_message: number; attachments: string | null
}> {
  const db = getDatabase()
  if (before) {
    return queryAll(db,
      `SELECT * FROM messages WHERE chat_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`,
      chatId, before, limit)
  }
  return queryAll(db,
    `SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?`,
    chatId, limit)
}

// ===== Chat Operations =====

export function upsertChat(chatId: string, agentId: string, name?: string, channel = 'web') {
  const db = getDatabase()
  const avatar = `gradient:${Math.floor(Math.random() * 8)}`
  db.run(
    `INSERT INTO chats (chat_id, name, agent_id, channel, last_message_time, avatar)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       last_message_time = excluded.last_message_time`,
    [chatId, name ?? chatId, agentId, channel, new Date().toISOString(), avatar]
  )
}

export function getChats(): Array<{
  chat_id: string; name: string; agent_id: string; channel: string;
  last_message_time: string; last_message: string | null; avatar: string | null
}> {
  const db = getDatabase()
  return queryAll(db, `
    SELECT c.chat_id, c.name, c.agent_id, c.channel, c.last_message_time, c.avatar,
           (SELECT m.content FROM messages m WHERE m.chat_id = c.chat_id ORDER BY m.timestamp DESC LIMIT 1) AS last_message
    FROM chats c
    ORDER BY c.last_message_time DESC
  `)
}

export function updateChatFields(chatId: string, updates: { name?: string; avatar?: string }) {
  const db = getDatabase()
  const fields: string[] = []
  const values: (string | null)[] = []

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
  if (updates.avatar !== undefined) { fields.push('avatar = ?'); values.push(updates.avatar) }

  if (fields.length === 0) return

  values.push(chatId)
  db.run(`UPDATE chats SET ${fields.join(', ')} WHERE chat_id = ?`, values)
}

export function deleteChat(chatId: string) {
  const db = getDatabase()
  db.run('DELETE FROM messages WHERE chat_id = ?', [chatId])
  db.run('DELETE FROM chats WHERE chat_id = ?', [chatId])
}

// ===== Session Operations =====

export function getSessionEntry(agentId: string, chatId: string): {
  sessionId: string
  sessionFile: string | null
} | null {
  const db = getDatabase()
  const row = queryGet<{ session_id: string; session_file: string | null }>(
    db,
    'SELECT session_id, session_file FROM sessions WHERE agent_id = ? AND chat_id = ?',
    agentId,
    chatId,
  )
  if (!row) return null
  return {
    sessionId: row.session_id,
    sessionFile: row.session_file ?? null,
  }
}

export function getSession(agentId: string, chatId: string): string | null {
  return getSessionEntry(agentId, chatId)?.sessionId ?? null
}

export function saveSession(agentId: string, chatId: string, sessionId: string, sessionFile?: string | null) {
  const db = getDatabase()
  db.run(
    `INSERT OR REPLACE INTO sessions (agent_id, chat_id, session_id, session_file) VALUES (?, ?, ?, ?)`,
    [agentId, chatId, sessionId, sessionFile ?? null]
  )
}

// ===== Scheduled Task Operations =====

export interface ScheduledTask {
  id: string
  agent_id: string
  chat_id: string
  prompt: string
  schedule_type: string
  schedule_value: string
  next_run: string | null
  last_run: string | null
  status: string
  created_at: string
  name: string | null
  description: string | null
  running_since: string | null
  consecutive_failures: number
  timezone: string | null
  last_result: string | null
  delivery_mode: string | null
  delivery_target: string | null
}

export interface TaskRunLog {
  id: number
  task_id: string
  run_at: string
  duration_ms: number
  status: string
  result: string | null
  error: string | null
  delivery_status: string | null
}

export function createTask(task: {
  id: string
  agentId: string
  chatId: string
  prompt: string
  scheduleType: string
  scheduleValue: string
  nextRun: string
  name?: string
  description?: string
  timezone?: string
  deliveryMode?: string
  deliveryTarget?: string
}): void {
  const db = getDatabase()
  db.run(
    `INSERT INTO scheduled_tasks (id, agent_id, chat_id, prompt, schedule_type, schedule_value, next_run, created_at, name, description, timezone, delivery_mode, delivery_target)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, task.agentId, task.chatId, task.prompt, task.scheduleType, task.scheduleValue, task.nextRun, new Date().toISOString(), task.name ?? null, task.description ?? null, task.timezone ?? null, task.deliveryMode ?? 'none', task.deliveryTarget ?? null]
  )
}

export function getTasks(): ScheduledTask[] {
  const db = getDatabase()
  return queryAll<ScheduledTask>(db, 'SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
}

export function getTask(id: string): ScheduledTask | null {
  const db = getDatabase()
  return queryGet<ScheduledTask>(db, 'SELECT * FROM scheduled_tasks WHERE id = ?', id)
}

export function updateTask(id: string, updates: Partial<{
  prompt: string
  scheduleType: string
  scheduleValue: string
  status: string
  nextRun: string | null
  lastRun: string
  name: string
  description: string
  runningSince: string | null
  consecutiveFailures: number
  timezone: string | null
  lastResult: string | null
  deliveryMode: string
  deliveryTarget: string | null
}>): void {
  const db = getDatabase()
  const fields: string[] = []
  const values: (string | number | null)[] = []

  if (updates.prompt !== undefined) { fields.push('prompt = ?'); values.push(updates.prompt) }
  if (updates.scheduleType !== undefined) { fields.push('schedule_type = ?'); values.push(updates.scheduleType) }
  if (updates.scheduleValue !== undefined) { fields.push('schedule_value = ?'); values.push(updates.scheduleValue) }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
  if (updates.nextRun !== undefined) { fields.push('next_run = ?'); values.push(updates.nextRun) }
  if (updates.lastRun !== undefined) { fields.push('last_run = ?'); values.push(updates.lastRun) }
  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
  if (updates.runningSince !== undefined) { fields.push('running_since = ?'); values.push(updates.runningSince) }
  if (updates.consecutiveFailures !== undefined) { fields.push('consecutive_failures = ?'); values.push(updates.consecutiveFailures) }
  if (updates.timezone !== undefined) { fields.push('timezone = ?'); values.push(updates.timezone) }
  if (updates.lastResult !== undefined) { fields.push('last_result = ?'); values.push(updates.lastResult) }
  if (updates.deliveryMode !== undefined) { fields.push('delivery_mode = ?'); values.push(updates.deliveryMode) }
  if (updates.deliveryTarget !== undefined) { fields.push('delivery_target = ?'); values.push(updates.deliveryTarget) }

  if (fields.length === 0) return

  values.push(id)
  db.run(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`, values)
}

export function deleteTask(id: string): void {
  const db = getDatabase()
  db.run('DELETE FROM scheduled_tasks WHERE id = ?', [id])
  db.run('DELETE FROM task_run_logs WHERE task_id = ?', [id])
}

export function getTasksDueBy(time: string): ScheduledTask[] {
  const db = getDatabase()
  return queryAll<ScheduledTask>(db,
    `SELECT * FROM scheduled_tasks WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ? AND running_since IS NULL`,
    time)
}

/** Query stuck tasks (running_since before the threshold) */
export function getStuckTasks(cutoffIso: string): ScheduledTask[] {
  const db = getDatabase()
  return queryAll<ScheduledTask>(db,
    `SELECT * FROM scheduled_tasks WHERE running_since IS NOT NULL AND running_since <= ?`,
    cutoffIso)
}

/** Prune expired run logs */
export function pruneOldTaskRunLogs(retainDays: number): number {
  const db = getDatabase()
  const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000).toISOString()
  const result = db.run('DELETE FROM task_run_logs WHERE run_at < ?', [cutoff])
  return result.changes
}

// ===== Run Logs =====

export function saveTaskRunLog(log: {
  taskId: string
  runAt: string
  durationMs: number
  status: string
  result?: string
  error?: string
  deliveryStatus?: string
}): void {
  const db = getDatabase()
  db.run(
    `INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error, delivery_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [log.taskId, log.runAt, log.durationMs, log.status, log.result ?? null, log.error ?? null, log.deliveryStatus ?? null]
  )
}

export function getTaskRunLogs(taskId: string, limit = 50): TaskRunLog[] {
  const db = getDatabase()
  return queryAll<TaskRunLog>(db,
    'SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC LIMIT ?',
    taskId, limit)
}

// ===== Browser Profile Operations =====

export interface BrowserProfile {
  id: string
  name: string
  created_at: string
}

export function createBrowserProfile(profile: { id: string; name: string }): void {
  const db = getDatabase()
  db.run(
    'INSERT INTO browser_profiles (id, name, created_at) VALUES (?, ?, ?)',
    [profile.id, profile.name, new Date().toISOString()]
  )
}

export function getBrowserProfiles(): BrowserProfile[] {
  const db = getDatabase()
  return queryAll<BrowserProfile>(db, 'SELECT * FROM browser_profiles ORDER BY created_at DESC')
}

export function getBrowserProfile(id: string): BrowserProfile | null {
  const db = getDatabase()
  return queryGet<BrowserProfile>(db, 'SELECT * FROM browser_profiles WHERE id = ?', id)
}

export function deleteBrowserProfile(id: string): void {
  const db = getDatabase()
  db.run('DELETE FROM browser_profiles WHERE id = ?', [id])
}

// ===== Channel Operations =====

export interface ChannelRecord {
  id: string
  type: string
  label: string
  config: string        // JSON string
  enabled: number       // 0 | 1
  created_at: string
  updated_at: string
}

export function createChannelRecord(record: {
  id: string
  type: string
  label: string
  config: string
  enabled?: boolean
}): ChannelRecord {
  const db = getDatabase()
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO channels (id, type, label, config, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.type, record.label, record.config, record.enabled === false ? 0 : 1, now, now]
  )
  return getChannelRecord(record.id)!
}

export function getChannelRecords(): ChannelRecord[] {
  const db = getDatabase()
  return queryAll<ChannelRecord>(db, 'SELECT * FROM channels ORDER BY created_at ASC')
}

export function getChannelRecord(id: string): ChannelRecord | null {
  const db = getDatabase()
  return queryGet<ChannelRecord>(db, 'SELECT * FROM channels WHERE id = ?', id)
}

export function updateChannelRecord(id: string, updates: Partial<{
  label: string
  config: string
  enabled: boolean
}>): ChannelRecord | null {
  const db = getDatabase()
  const fields: string[] = []
  const values: (string | number)[] = []

  if (updates.label !== undefined) { fields.push('label = ?'); values.push(updates.label) }
  if (updates.config !== undefined) { fields.push('config = ?'); values.push(updates.config) }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0) }

  if (fields.length === 0) return getChannelRecord(id)

  fields.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)

  db.run(`UPDATE channels SET ${fields.join(', ')} WHERE id = ?`, values)
  return getChannelRecord(id)
}

export function deleteChannelRecord(id: string): void {
  const db = getDatabase()
  db.run('DELETE FROM channels WHERE id = ?', [id])
}

// ===== Skill Settings =====

export type SkillSettings = Record<string, { enabled: boolean }>

export function getSkillSettings(): SkillSettings {
  const db = getDatabase()
  const row = queryGet<{ value: string }>(db, "SELECT value FROM kv_state WHERE key = 'skill_settings'")
  if (!row) return {}
  try {
    return JSON.parse(row.value) as SkillSettings
  } catch {
    return {}
  }
}

export function setSkillEnabled(name: string, enabled: boolean): void {
  const db = getDatabase()
  const settings = getSkillSettings()
  settings[name] = { enabled }
  db.run(
    "INSERT OR REPLACE INTO kv_state (key, value) VALUES ('skill_settings', ?)",
    [JSON.stringify(settings)]
  )
}
