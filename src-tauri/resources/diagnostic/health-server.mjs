import http from 'node:http'
import os from 'node:os'
import process from 'node:process'

const port = Number.parseInt(process.env.PORT || '62601', 10)
const runtime = process.env.YOUCLAW_RUNTIME_KIND || 'unknown'
const mode = process.env.YOUCLAW_SERVER_MODE || 'diagnostic'
const startedAt = new Date().toISOString()

function healthPayload() {
  return {
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
    logDir: process.env.YOUCLAW_LOG_DIR || null,
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
    sendJson(res, 200, healthPayload())
    return
  }

  sendJson(res, 404, {
    status: 'not_found',
    path: req.url || '/',
  })
})

server.on('listening', () => {
  console.log(`[diagnostic-server] listening on http://127.0.0.1:${port} (runtime=${runtime}, pid=${process.pid})`)
})

server.on('error', (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(`[diagnostic-server] server error: ${message}`)
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  console.error(`[diagnostic-server] uncaughtException: ${error.stack || error.message}`)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error(`[diagnostic-server] unhandledRejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`)
  process.exit(1)
})

function shutdown(signal) {
  console.log(`[diagnostic-server] received ${signal}, shutting down`)
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

server.listen(port, '127.0.0.1')
