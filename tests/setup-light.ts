/**
 * Lightweight test initialization
 *
 * Only initializes environment variables and logger, not the database.
 * Used for tests that do not require a database.
 */

// Set test environment variables
process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.DATA_DIR = '/tmp/youclaw-test-' + Date.now()
process.env.LOG_LEVEL = 'error'

import { loadEnv } from '../src/config/index.ts'
import { initLogger } from '../src/logger/index.ts'

// Initialize
loadEnv()
initLogger()
