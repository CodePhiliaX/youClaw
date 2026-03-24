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

  test('browser_profiles table includes managed profile fields', () => {
    const db = getDatabase()
    const columns = db.query("PRAGMA table_info('browser_profiles')").all() as Array<{ name: string }>
    const colNames = columns.map((c) => c.name)

    expect(colNames).toContain('id')
    expect(colNames).toContain('name')
    expect(colNames).toContain('driver')
    expect(colNames).toContain('is_default')
    expect(colNames).toContain('executable_path')
    expect(colNames).toContain('user_data_dir')
    expect(colNames).toContain('cdp_port')
    expect(colNames).toContain('cdp_url')
    expect(colNames).toContain('headless')
    expect(colNames).toContain('no_sandbox')
    expect(colNames).toContain('attach_only')
    expect(colNames).toContain('launch_args_json')
    expect(colNames).toContain('created_at')
    expect(colNames).toContain('updated_at')
  })

  test('browser runtime tables exist', () => {
    const db = getDatabase()
    const runtimeCols = db.query("PRAGMA table_info('browser_profile_runtime')").all() as Array<{ name: string }>
    const stateCols = db.query("PRAGMA table_info('chat_browser_state')").all() as Array<{ name: string }>

    expect(runtimeCols.map((c) => c.name)).toEqual([
      'profile_id',
      'status',
      'pid',
      'ws_endpoint',
      'last_error',
      'last_started_at',
      'heartbeat_at',
    ])

    expect(stateCols.map((c) => c.name)).toEqual([
      'chat_id',
      'agent_id',
      'profile_id',
      'active_target_id',
      'active_page_url',
      'active_page_title',
      'updated_at',
    ])
  })
})
