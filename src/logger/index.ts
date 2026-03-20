import pino from 'pino'
import { Writable } from 'node:stream'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { resolve } from 'node:path'
import { getEnv } from '../config/index.ts'
import { getPaths } from '../config/index.ts'
import { logBroadcaster } from './broadcaster.ts'
import type { PinoLogEntry } from './reader.ts'

let _logger: pino.Logger | null = null

// Check date on each write, automatically rotate log files
class DailyRotatingStream extends Writable {
  private currentDate = ''
  private fileStream: WriteStream | null = null
  private logsDir: string

  constructor(logsDir: string) {
    super()
    this.logsDir = logsDir
    mkdirSync(logsDir, { recursive: true })
  }

  override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    const today = new Date().toISOString().split('T')[0]!
    if (today !== this.currentDate || !this.fileStream) {
      this.fileStream?.end()
      this.currentDate = today
      try {
        this.fileStream = createWriteStream(resolve(this.logsDir, `${today}.log`), { flags: 'a' })
        this.fileStream.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error('[LOGGER] File stream error:', err instanceof Error ? err.message : String(err))
          this.fileStream = null
        })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[LOGGER] Failed to open log file stream:', err instanceof Error ? err.message : String(err))
        this.fileStream = null
      }
    }
    if (!this.fileStream) {
      callback()
      return
    }

    try {
      this.fileStream.write(chunk, encoding, () => callback())
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[LOGGER] Failed to write log chunk:', err instanceof Error ? err.message : String(err))
      this.fileStream = null
      callback()
    }

    // Broadcast log entry for SSE subscribers
    try {
      const text = chunk.toString()
      for (const line of text.split('\n')) {
        if (!line) continue
        const entry = JSON.parse(line) as PinoLogEntry
        logBroadcaster.emit(entry)
      }
    } catch {
      // Non-JSON or parse errors are silently ignored
    }
  }

  override _final(callback: (error?: Error | null) => void) {
    this.fileStream?.end(callback)
  }
}

export function initLogger(): pino.Logger {
  if (_logger) return _logger
  const env = getEnv()
  const logsDir = getPaths().logs

  const streams: pino.StreamEntry[] = [
    { level: env.LOG_LEVEL as pino.Level, stream: process.stdout },
  ]

  let fileLogInitError: string | null = null
  try {
    streams.push({ level: env.LOG_LEVEL as pino.Level, stream: new DailyRotatingStream(logsDir) })
  } catch (err) {
    fileLogInitError = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error('[LOGGER] Failed to initialize file logging stream:', fileLogInitError)
  }

  try {
    _logger = streams.length > 1
      ? pino({ level: env.LOG_LEVEL }, pino.multistream(streams))
      : pino({ level: env.LOG_LEVEL }, process.stdout)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[LOGGER] Failed to initialize logger, falling back to stdout only:', err instanceof Error ? err.message : String(err))
    _logger = pino({ level: env.LOG_LEVEL }, process.stdout)
  }

  if (fileLogInitError) {
    _logger.warn({ logsDir, error: fileLogInitError, category: 'system' }, 'File logging disabled, running with stdout only')
  }

  return _logger
}

export function getLogger(): pino.Logger {
  if (!_logger) throw new Error('Logger not initialized')
  return _logger
}
