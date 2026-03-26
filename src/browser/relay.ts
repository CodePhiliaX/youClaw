import { randomBytes, timingSafeEqual } from 'node:crypto'
import { getDatabase } from '../db/index.ts'

const RELAY_TOKEN_KEY_PREFIX = 'browser_relay_token:'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const SUPPORTED_CDP_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])

type RelayConnection = {
  cdpUrl: string
  connectedAt: string
  updatedAt: string
}

export interface BrowserRelayState {
  token: string
  connected: boolean
  cdpUrl: string | null
  connectedAt: string | null
  updatedAt: string | null
}

export class BrowserRelayTokenError extends Error {
  constructor(message = 'Invalid relay token') {
    super(message)
    this.name = 'BrowserRelayTokenError'
  }
}

const relayConnections = new Map<string, RelayConnection>()

function relayTokenKey(profileId: string): string {
  return `${RELAY_TOKEN_KEY_PREFIX}${profileId}`
}

function createRelayToken(): string {
  return randomBytes(24).toString('base64url')
}

function readRelayToken(profileId: string): string | null {
  const db = getDatabase()
  const row = db
    .query('SELECT value FROM kv_state WHERE key = ?')
    .get(relayTokenKey(profileId)) as { value: string } | null
  return row?.value ?? null
}

function saveRelayToken(profileId: string, token: string): void {
  const db = getDatabase()
  db.run('INSERT OR REPLACE INTO kv_state (key, value) VALUES (?, ?)', [
    relayTokenKey(profileId),
    token,
  ])
}

function tokensMatch(expected: string, actual: string): boolean {
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function ensureBrowserRelayToken(profileId: string): string {
  const existing = readRelayToken(profileId)
  if (existing) return existing

  const token = createRelayToken()
  saveRelayToken(profileId, token)
  return token
}

export function getBrowserRelayState(profileId: string): BrowserRelayState {
  const token = ensureBrowserRelayToken(profileId)
  const connection = relayConnections.get(profileId)

  return {
    token,
    connected: !!connection,
    cdpUrl: connection?.cdpUrl ?? null,
    connectedAt: connection?.connectedAt ?? null,
    updatedAt: connection?.updatedAt ?? null,
  }
}

export function assertBrowserRelayToken(profileId: string, token: string): void {
  const expected = ensureBrowserRelayToken(profileId)
  if (!tokensMatch(expected, token.trim())) {
    throw new BrowserRelayTokenError()
  }
}

export function normalizeLoopbackCdpUrl(raw: string): string {
  const value = raw.trim()
  if (!value) {
    throw new Error('CDP URL is required')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('CDP URL is invalid')
  }

  if (!SUPPORTED_CDP_PROTOCOLS.has(url.protocol)) {
    throw new Error('CDP URL must use http, https, ws, or wss')
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('Extension relay only accepts loopback CDP URLs')
  }

  url.hash = ''
  return url.toString()
}

export function setBrowserRelayConnection(profileId: string, cdpUrl: string): BrowserRelayState {
  const current = relayConnections.get(profileId)
  const now = new Date().toISOString()

  relayConnections.set(profileId, {
    cdpUrl,
    connectedAt: current?.connectedAt ?? now,
    updatedAt: now,
  })

  return getBrowserRelayState(profileId)
}

export function clearBrowserRelayConnection(profileId: string): BrowserRelayState {
  relayConnections.delete(profileId)
  return getBrowserRelayState(profileId)
}

export function getBrowserRelayCdpUrl(profileId: string): string | null {
  return relayConnections.get(profileId)?.cdpUrl ?? null
}

export function rotateBrowserRelayToken(profileId: string): BrowserRelayState {
  const token = createRelayToken()
  saveRelayToken(profileId, token)
  relayConnections.delete(profileId)
  return getBrowserRelayState(profileId)
}

export function deleteBrowserRelayProfile(profileId: string): void {
  relayConnections.delete(profileId)
  const db = getDatabase()
  db.run('DELETE FROM kv_state WHERE key = ?', [relayTokenKey(profileId)])
}
