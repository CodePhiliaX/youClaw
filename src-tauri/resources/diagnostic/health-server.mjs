import http from 'node:http'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import os from 'node:os'
import process from 'node:process'

const signature = 'youclaw-diagnostic-v1'
const port = Number.parseInt(process.env.PORT || '62601', 10)
const runtime = process.env.YOUCLAW_RUNTIME_KIND || 'unknown'
const mode = process.env.YOUCLAW_SERVER_MODE || 'diagnostic'
const startedAt = new Date().toISOString()
const logFile = process.env.YOUCLAW_DIAGNOSTIC_LOG_FILE || null

function logLine(level, message, extra) {
  const line = `[${new Date().toISOString()}] [${runtime}] [${level}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}`
  if (level === 'error') {
    console.error(line)
  } else {
    console.log(line)
  }

  if (logFile) {
    try {
      mkdirSync(dirname(logFile), { recursive: true })
      appendFileSync(logFile, `${line}\n`, 'utf-8')
    } catch {}
  }
}

function healthPayload() {
  return {
    signature,
    status: 'ok',
    mode,
    runtime,
    port,
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    uptime: process.uptime(),
    startedAt,
    execPath: process.execPath,
    cwd: process.cwd(),
    nodeVersion: process.versions.node ?? null,
    bunVersion: process.versions.bun ?? null,
    runtimeVersion: process.version ?? null,
    logDir: process.env.YOUCLAW_LOG_DIR || null,
    logFile,
    tempDir: process.env.TEMP || process.env.TMP || os.tmpdir(),
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    logLine('info', 'health request', { url: req.url, pid: process.pid })
    sendJson(res, 200, healthPayload())
    return
  }

  sendJson(res, 404, {
    status: 'not_found',
    path: req.url || '/',
  })
})

server.on('listening', () => {
  logLine('info', 'diagnostic server listening', {
    url: `http://127.0.0.1:${port}`,
    pid: process.pid,
    execPath: process.execPath,
    cwd: process.cwd(),
    nodeVersion: process.versions.node ?? null,
    bunVersion: process.versions.bun ?? null,
    logFile,
  })
})

server.on('error', (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  logLine('error', 'server error', { message })
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  logLine('error', 'uncaughtException', { message: error.stack || error.message })
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logLine('error', 'unhandledRejection', { message: reason instanceof Error ? reason.stack || reason.message : String(reason) })
  process.exit(1)
})

function shutdown(signal) {
  logLine('info', 'shutdown requested', { signal })
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

server.listen(port, '127.0.0.1')
