import pino from 'pino'
import { Writable } from 'node:stream'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { resolve } from 'node:path'
import { getEnv } from '../config/index.ts'
import { getPaths } from '../config/index.ts'

let _logger: pino.Logger | null = null

// 每次 write 时检查日期，自动轮转文件
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
    if (today !== this.currentDate) {
      this.fileStream?.end()
      this.currentDate = today
      this.fileStream = createWriteStream(resolve(this.logsDir, `${today}.log`), { flags: 'a' })
    }
    this.fileStream!.write(chunk, encoding, callback)
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
    { level: env.LOG_LEVEL as pino.Level, stream: new DailyRotatingStream(logsDir) },
  ]

  _logger = pino({ level: env.LOG_LEVEL }, pino.multistream(streams))
  return _logger
}

export function getLogger(): pino.Logger {
  if (!_logger) throw new Error('Logger 未初始化')
  return _logger
}
