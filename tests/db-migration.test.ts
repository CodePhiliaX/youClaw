/**
 * Database migration tests
 *
 * Verify the name/description column migration for the scheduled_tasks table
 */

import { describe, test, expect } from 'bun:test'
import { getDatabase } from './setup.ts'

describe('database migration — name/description fields', () => {
  test('scheduled_tasks table contains all expected columns', () => {
    const db = getDatabase()
    const columns = db.query("PRAGMA table_info('scheduled_tasks')").all() as Array<{ name: string; type: string }>
    const colNames = columns.map((c) => c.name)

    // Original fields
    expect(colNames).toContain('id')
    expect(colNames).toContain('agent_id')
    expect(colNames).toContain('chat_id')
    expect(colNames).toContain('prompt')
    expect(colNames).toContain('schedule_type')
    expect(colNames).toContain('schedule_value')
    expect(colNames).toContain('next_run')
    expect(colNames).toContain('last_run')
    expect(colNames).toContain('status')
    expect(colNames).toContain('created_at')

    // Newly added fields
    expect(colNames).toContain('name')
    expect(colNames).toContain('description')
  })

  test('name and description column types are TEXT', () => {
    const db = getDatabase()
    const columns = db.query("PRAGMA table_info('scheduled_tasks')").all() as Array<{ name: string; type: string }>

    const nameCol = columns.find((c) => c.name === 'name')
    const descCol = columns.find((c) => c.name === 'description')

    expect(nameCol!.type).toBe('TEXT')
    expect(descCol!.type).toBe('TEXT')
  })

  test('repeated ALTER TABLE does not throw (try-catch swallows exception)', () => {
    const db = getDatabase()
    expect(() => {
      try { db.exec('ALTER TABLE scheduled_tasks ADD COLUMN name TEXT') } catch {}
      try { db.exec('ALTER TABLE scheduled_tasks ADD COLUMN description TEXT') } catch {}
    }).not.toThrow()
  })

  test('messages table structure is correct', () => {
    const db = getDatabase()
    const columns = db.query("PRAGMA table_info('messages')").all() as Array<{ name: string }>
    const colNames = columns.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('chat_id')
    expect(colNames).toContain('sender')
    expect(colNames).toContain('sender_name')
    expect(colNames).toContain('content')
    expect(colNames).toContain('timestamp')
    expect(colNames).toContain('is_from_me')
    expect(colNames).toContain('is_bot_message')
  })

  test('chats table structure is correct', () => {
    const db = getDatabase()
    const columns = db.query("PRAGMA table_info('chats')").all() as Array<{ name: string }>
    const colNames = columns.map((c) => c.name)
    expect(colNames).toContain('chat_id')
    expect(colNames).toContain('name')
    expect(colNames).toContain('agent_id')
    expect(colNames).toContain('channel')
    expect(colNames).toContain('is_group')
    expect(colNames).toContain('last_message_time')
  })

  test('task_run_logs table structure is correct', () => {
    const db = getDatabase()
    const columns = db.query("PRAGMA table_info('task_run_logs')").all() as Array<{ name: string }>
    const colNames = columns.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('task_id')
    expect(colNames).toContain('run_at')
    expect(colNames).toContain('duration_ms')
    expect(colNames).toContain('status')
    expect(colNames).toContain('result')
    expect(colNames).toContain('error')
  })
})
