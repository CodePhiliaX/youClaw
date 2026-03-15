/**
 * Shared test initialization
 *
 * All test files import this module to initialize environment, database, and logger.
 * Avoids duplicate initialization conflicts.
 */

import { Database } from 'bun:sqlite'

// Set test environment variables
process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.DATA_DIR = '/tmp/youclaw-test-' + Date.now()
process.env.LOG_LEVEL = 'error'

import { loadEnv } from '../src/config/index.ts'
import { initLogger } from '../src/logger/index.ts'
import { initDatabase, getDatabase } from '../src/db/index.ts'

// Initialize
loadEnv()
initLogger()
initDatabase()

/** Clear all data tables */
export function cleanAllTables() {
  const db = getDatabase()
  db.run('DELETE FROM messages')
  db.run('DELETE FROM chats')
  db.run('DELETE FROM scheduled_tasks')
  db.run('DELETE FROM task_run_logs')
  db.run('DELETE FROM sessions')
}

/** Clear specified tables */
export function cleanTables(...tables: string[]) {
  const db = getDatabase()
  for (const table of tables) {
    db.run(`DELETE FROM ${table}`)
  }
}

export { getDatabase }
