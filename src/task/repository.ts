import { getDatabase } from '../db/index.ts'
import type { ScheduledTask, TaskRunLog } from '../db/index.ts'

type SQLValue = string | number | boolean | null

function queryAll<T>(sql: string, ...params: SQLValue[]): T[] {
  const db = getDatabase()
  return db.query(sql).all(...params) as T[]
}

function queryGet<T>(sql: string, ...params: SQLValue[]): T | null {
  const db = getDatabase()
  const row = db.query(sql).get(...params)
  return (row as T) ?? null
}

export interface TaskRepositoryListFilters {
  agentId?: string
  chatId?: string
  name?: string
  status?: string
  limit?: number
}

export interface InsertTaskRecord {
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
}

export interface UpdateTaskRecord {
  prompt?: string
  scheduleType?: string
  scheduleValue?: string
  status?: string
  nextRun?: string | null
  lastRun?: string
  name?: string | null
  description?: string
  runningSince?: string | null
  consecutiveFailures?: number
  timezone?: string | null
  lastResult?: string | null
  deliveryMode?: string
  deliveryTarget?: string | null
}

export interface InsertTaskRunLogRecord {
  taskId: string
  runAt: string
  durationMs: number
  status: string
  result?: string
  error?: string
  deliveryStatus?: string
}

export function listAllTasks(limit?: number): ScheduledTask[] {
  let sql = 'SELECT * FROM scheduled_tasks ORDER BY created_at DESC'
  const params: SQLValue[] = []

  if (limit && limit > 0) {
    sql += ' LIMIT ?'
    params.push(limit)
  }

  return queryAll<ScheduledTask>(sql, ...params)
}

export function listTasks(filters: TaskRepositoryListFilters): ScheduledTask[] {
  const conditions: string[] = []
  const params: SQLValue[] = []

  if (filters.agentId) {
    conditions.push('agent_id = ?')
    params.push(filters.agentId)
  }
  if (filters.chatId) {
    conditions.push('chat_id = ?')
    params.push(filters.chatId)
  }
  if (filters.status) {
    conditions.push('status = ?')
    params.push(filters.status)
  }
  if (filters.name) {
    conditions.push('name = ?')
    params.push(filters.name)
  }

  let sql = 'SELECT * FROM scheduled_tasks'
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }
  sql += ' ORDER BY created_at DESC'

  if (filters.limit && filters.limit > 0) {
    sql += ' LIMIT ?'
    params.push(filters.limit)
  }

  return queryAll<ScheduledTask>(sql, ...params)
}

export function getTaskById(id: string): ScheduledTask | null {
  return queryGet<ScheduledTask>('SELECT * FROM scheduled_tasks WHERE id = ?', id)
}

export function listTasksByName(agentId: string, chatId: string, name: string): ScheduledTask[] {
  return listTasks({ agentId, chatId, name })
}

export function insertTaskRecord(task: InsertTaskRecord): void {
  const db = getDatabase()
  db.run(
    `INSERT INTO scheduled_tasks (id, agent_id, chat_id, prompt, schedule_type, schedule_value, next_run, created_at, name, description, timezone, delivery_mode, delivery_target)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.agentId,
      task.chatId,
      task.prompt,
      task.scheduleType,
      task.scheduleValue,
      task.nextRun,
      new Date().toISOString(),
      task.name ?? null,
      task.description ?? null,
      task.timezone ?? null,
      task.deliveryMode ?? 'none',
      task.deliveryTarget ?? null,
    ],
  )
}

export function updateTaskById(id: string, updates: UpdateTaskRecord): void {
  const db = getDatabase()
  const fields: string[] = []
  const values: SQLValue[] = []

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

export function deleteTaskById(id: string): void {
  const db = getDatabase()
  db.run('DELETE FROM scheduled_tasks WHERE id = ?', [id])
  db.run('DELETE FROM task_run_logs WHERE task_id = ?', [id])
}

export function listDueTasks(timeIso: string): ScheduledTask[] {
  return queryAll<ScheduledTask>(
    `SELECT * FROM scheduled_tasks
     WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ? AND running_since IS NULL`,
    timeIso,
  )
}

export function listStuckTasks(cutoffIso: string): ScheduledTask[] {
  return queryAll<ScheduledTask>(
    'SELECT * FROM scheduled_tasks WHERE running_since IS NOT NULL AND running_since <= ?',
    cutoffIso,
  )
}

export function insertTaskRunLog(log: InsertTaskRunLogRecord): void {
  const db = getDatabase()
  db.run(
    `INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error, delivery_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [log.taskId, log.runAt, log.durationMs, log.status, log.result ?? null, log.error ?? null, log.deliveryStatus ?? null],
  )
}

export function listTaskRunLogs(taskId: string, limit = 50): TaskRunLog[] {
  return queryAll<TaskRunLog>(
    'SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC LIMIT ?',
    taskId, limit,
  )
}

export function deleteTaskRunLogsOlderThan(cutoffIso: string): number {
  const db = getDatabase()
  const result = db.run('DELETE FROM task_run_logs WHERE run_at < ?', [cutoffIso])
  return result.changes
}

