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
`

export function initDatabase(): Database {
  if (_db) return _db

  const paths = getPaths()
  mkdirSync(dirname(paths.db), { recursive: true })

  _db = new Database(paths.db)
  _db.exec('PRAGMA journal_mode=WAL')
  _db.exec('PRAGMA foreign_keys=ON')
  _db.exec(SCHEMA)

  // 迁移：添加 name 和 description 列
  try { _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN name TEXT') } catch {}
  try { _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN description TEXT') } catch {}

  getLogger().info({ path: paths.db }, '数据库初始化完成')
  return _db
}

export function getDatabase(): Database {
  if (!_db) throw new Error('数据库未初始化')
  return _db
}

// ===== 消息操作 =====

export function saveMessage(msg: {
  id: string
  chatId: string
  sender: string
  senderName: string
  content: string
  timestamp: string
  isFromMe: boolean
  isBotMessage: boolean
}) {
  const db = getDatabase()
  db.run(
    `INSERT OR REPLACE INTO messages (id, chat_id, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [msg.id, msg.chatId, msg.sender, msg.senderName, msg.content, msg.timestamp, msg.isFromMe ? 1 : 0, msg.isBotMessage ? 1 : 0]
  )
}

export function getMessages(chatId: string, limit = 50, before?: string): Array<{
  id: string; chat_id: string; sender: string; sender_name: string
  content: string; timestamp: string; is_from_me: number; is_bot_message: number
}> {
  const db = getDatabase()
  if (before) {
    return db.query(
      `SELECT * FROM messages WHERE chat_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?`
    ).all(chatId, before, limit) as any
  }
  return db.query(
    `SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?`
  ).all(chatId, limit) as any
}

// ===== Chat 操作 =====

export function upsertChat(chatId: string, agentId: string, name?: string, channel = 'web') {
  const db = getDatabase()
  db.run(
    `INSERT INTO chats (chat_id, name, agent_id, channel, last_message_time)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       last_message_time = excluded.last_message_time,
       name = COALESCE(excluded.name, chats.name)`,
    [chatId, name ?? chatId, agentId, channel, new Date().toISOString()]
  )
}

export function getChats(): Array<{
  chat_id: string; name: string; agent_id: string; channel: string; last_message_time: string
}> {
  const db = getDatabase()
  return db.query('SELECT * FROM chats ORDER BY last_message_time DESC').all() as any
}

// ===== Session 操作 =====

export function getSession(agentId: string, chatId: string): string | null {
  const db = getDatabase()
  const row = db.query('SELECT session_id FROM sessions WHERE agent_id = ? AND chat_id = ?').get(agentId, chatId) as any
  return row?.session_id ?? null
}

export function saveSession(agentId: string, chatId: string, sessionId: string) {
  const db = getDatabase()
  db.run(
    `INSERT OR REPLACE INTO sessions (agent_id, chat_id, session_id) VALUES (?, ?, ?)`,
    [agentId, chatId, sessionId]
  )
}

// ===== 定时任务操作 =====

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
}

export interface TaskRunLog {
  id: number
  task_id: string
  run_at: string
  duration_ms: number
  status: string
  result: string | null
  error: string | null
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
}): void {
  const db = getDatabase()
  db.run(
    `INSERT INTO scheduled_tasks (id, agent_id, chat_id, prompt, schedule_type, schedule_value, next_run, created_at, name, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, task.agentId, task.chatId, task.prompt, task.scheduleType, task.scheduleValue, task.nextRun, new Date().toISOString(), task.name ?? null, task.description ?? null]
  )
}

export function getTasks(): ScheduledTask[] {
  const db = getDatabase()
  return db.query('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as ScheduledTask[]
}

export function getTask(id: string): ScheduledTask | null {
  const db = getDatabase()
  return (db.query('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTask | null) ?? null
}

export function updateTask(id: string, updates: Partial<{
  prompt: string
  scheduleValue: string
  status: string
  nextRun: string | null
  lastRun: string
  name: string
  description: string
}>): void {
  const db = getDatabase()
  const fields: string[] = []
  const values: (string | number | null)[] = []

  if (updates.prompt !== undefined) { fields.push('prompt = ?'); values.push(updates.prompt) }
  if (updates.scheduleValue !== undefined) { fields.push('schedule_value = ?'); values.push(updates.scheduleValue) }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
  if (updates.nextRun !== undefined) { fields.push('next_run = ?'); values.push(updates.nextRun) }
  if (updates.lastRun !== undefined) { fields.push('last_run = ?'); values.push(updates.lastRun) }
  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }

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
  return db.query(
    `SELECT * FROM scheduled_tasks WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?`
  ).all(time) as ScheduledTask[]
}

// ===== 运行日志 =====

export function saveTaskRunLog(log: {
  taskId: string
  runAt: string
  durationMs: number
  status: string
  result?: string
  error?: string
}): void {
  const db = getDatabase()
  db.run(
    `INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [log.taskId, log.runAt, log.durationMs, log.status, log.result ?? null, log.error ?? null]
  )
}

export function getTaskRunLogs(taskId: string, limit = 50): TaskRunLog[] {
  const db = getDatabase()
  return db.query(
    'SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC LIMIT ?'
  ).all(taskId, limit) as TaskRunLog[]
}
