import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createServer, connect as connectTcp } from 'node:net'
import { connect as connectTls } from 'node:tls'
import type { BrowserProfile } from './types.ts'
import { DEFAULT_CDP_PORT_END, DEFAULT_CDP_PORT_START } from './types.ts'
import { withNoProxyForCdpUrl } from './cdp-proxy-bypass.ts'

export interface ChromeLaunchResult {
  child: ChildProcess
  executablePath: string
  launchArgs: string[]
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
}

function parseHttpJsonResponse(raw: Buffer): unknown {
  const delimiter = Buffer.from('\r\n\r\n')
  const headerEnd = raw.indexOf(delimiter)
  if (headerEnd === -1) {
    throw new Error('Invalid HTTP response from CDP endpoint')
  }

  const headerText = raw.subarray(0, headerEnd).toString('utf8')
  const body = raw.subarray(headerEnd + delimiter.length).toString('utf8')
  const [statusLine] = headerText.split('\r\n')
  const match = statusLine?.match(/^HTTP\/1\.[01]\s+(\d{3})/)
  const statusCode = Number(match?.[1] ?? '500')
  if (statusCode >= 400) {
    throw new Error(`CDP probe failed: ${statusCode}`)
  }

  return body ? JSON.parse(body) : {}
}

function readJsonDirect(url: URL): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const port = Number(url.port || (url.protocol === 'https:' ? '443' : '80'))
    const hostname = url.hostname === '[::1]' ? '::1' : url.hostname
    const path = `${url.pathname}${url.search}`
    const socket = url.protocol === 'https:'
      ? connectTls({ host: hostname, port, servername: hostname === '::1' ? undefined : hostname })
      : connectTcp({ host: hostname, port })

    const chunks: Buffer[] = []
    let resolved = false
    const finalize = () => {
      if (resolved) return
      try {
        const raw = Buffer.concat(chunks)
        const delimiter = Buffer.from('\r\n\r\n')
        const headerEnd = raw.indexOf(delimiter)
        if (headerEnd === -1) return
        const headerText = raw.subarray(0, headerEnd).toString('utf8')
        const contentLengthMatch = headerText.match(/^Content-Length:\s*(\d+)/im)
        if (contentLengthMatch) {
          const expectedLength = Number(contentLengthMatch[1] ?? '0')
          const bodyLength = raw.length - headerEnd - delimiter.length
          if (bodyLength < expectedLength) return
        }
        resolved = true
        resolve(parseHttpJsonResponse(raw))
        socket.destroy()
      } catch (err) {
        resolved = true
        reject(err)
        socket.destroy()
      }
    }
    socket.on('connect', () => {
      socket.write(`GET ${path || '/'} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`)
    })
    socket.on('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      finalize()
    })
    socket.on('end', finalize)
    socket.on('error', (err) => {
      if (!resolved) {
        reject(err)
      }
    })
  })
}

function readJson(url: URL): Promise<unknown> {
  if (isLoopbackHost(url.hostname)) {
    return readJsonDirect(url)
  }

  const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = requestImpl(url, { method: 'GET' }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(`CDP probe failed: ${res.statusCode} ${res.statusMessage ?? ''}`.trim()))
          return
        }
        try {
          resolve(body ? JSON.parse(body) : {})
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

export function detectChromeExecutable(): string | null {
  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : process.platform === 'win32'
        ? [
            `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
          ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }

  return null
}

export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => {
      resolve(false)
    })
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

export async function findAvailablePort(start = DEFAULT_CDP_PORT_START, end = DEFAULT_CDP_PORT_END): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`No available CDP port found in range ${start}-${end}`)
}

export function buildChromeLaunchArgs(profile: BrowserProfile): string[] {
  if (!profile.userDataDir) {
    throw new Error(`Managed browser profile "${profile.id}" is missing userDataDir`)
  }
  if (!profile.cdpPort) {
    throw new Error(`Managed browser profile "${profile.id}" is missing cdpPort`)
  }

  const args = [
    `--remote-debugging-port=${profile.cdpPort}`,
    `--user-data-dir=${profile.userDataDir}`,
    '--no-first-run',
    '--disable-sync',
    '--password-store=basic',
  ]

  if (profile.headless) {
    args.push('--headless=new')
  }
  if (profile.noSandbox) {
    args.push('--no-sandbox')
  }
  if (profile.launchArgs.length > 0) {
    args.push(...profile.launchArgs)
  }

  args.push('about:blank')
  return args
}

export function spawnManagedChrome(profile: BrowserProfile): ChromeLaunchResult {
  const executablePath = profile.executablePath ?? detectChromeExecutable()
  if (!executablePath) {
    throw new Error('Chrome executable not found')
  }
  if (!profile.userDataDir) {
    throw new Error(`Managed browser profile "${profile.id}" is missing userDataDir`)
  }

  mkdirSync(profile.userDataDir, { recursive: true })
  const launchArgs = buildChromeLaunchArgs(profile)
  const child = spawn(executablePath, launchArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  return { child, executablePath, launchArgs }
}

export function resolveCdpHttpBase(profile: BrowserProfile): string {
  if (profile.cdpUrl) {
    const url = new URL(profile.cdpUrl)
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
    }
    return `${url.protocol}//${url.host}`
  }

  if (profile.cdpPort) {
    return `http://127.0.0.1:${profile.cdpPort}`
  }

  throw new Error(`Browser profile "${profile.id}" has no CDP endpoint`)
}

export async function probeCdpVersion(profile: BrowserProfile): Promise<{ webSocketDebuggerUrl: string | null; browser: string | null }> {
  const base = resolveCdpHttpBase(profile)
  const body = await withNoProxyForCdpUrl(base, async () =>
    readJson(new URL('/json/version', `${base}/`)) as Promise<{ webSocketDebuggerUrl?: string; Browser?: string }>,
  )
  return {
    webSocketDebuggerUrl: body.webSocketDebuggerUrl ?? null,
    browser: body.Browser ?? null,
  }
}

export async function requestCdpJson<T>(profile: BrowserProfile, pathname: string): Promise<T> {
  const base = resolveCdpHttpBase(profile)
  return withNoProxyForCdpUrl(base, async () =>
    readJson(new URL(pathname, `${base}/`)) as Promise<T>,
  )
}

export async function waitForCdpReady(profile: BrowserProfile, timeoutMs = 15_000): Promise<{ webSocketDebuggerUrl: string | null; browser: string | null }> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'CDP endpoint did not become ready'

  while (Date.now() < deadline) {
    try {
      return await probeCdpVersion(profile)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  throw new Error(lastError)
}
