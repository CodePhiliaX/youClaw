const LOOPBACK_ENTRIES = 'localhost,127.0.0.1,[::1]'

function hasProxyEnv(): boolean {
  return Boolean(
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy,
  )
}

function isLoopbackCdpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

function noProxyAlreadyCoversLoopback(): boolean {
  const current = process.env.NO_PROXY || process.env.no_proxy || ''
  return current.includes('localhost') && current.includes('127.0.0.1') && current.includes('[::1]')
}

type EnvSnapshot = {
  NO_PROXY: string | undefined
  no_proxy: string | undefined
}

const leaseState = {
  count: 0,
  snapshot: null as EnvSnapshot | null,
  applied: null as string | null,
}

export async function withNoProxyForCdpUrl<T>(url: string, fn: () => Promise<T>): Promise<T> {
  let release: (() => void) | null = null

  if (isLoopbackCdpUrl(url) && hasProxyEnv()) {
    release = acquireNoProxyLease()
  }

  try {
    return await fn()
  } finally {
    release?.()
  }
}

function acquireNoProxyLease(): () => void {
  if (leaseState.count === 0 && !noProxyAlreadyCoversLoopback()) {
    const snapshot = {
      NO_PROXY: process.env.NO_PROXY,
      no_proxy: process.env.no_proxy,
    }
    const current = snapshot.NO_PROXY || snapshot.no_proxy || ''
    const applied = current ? `${current},${LOOPBACK_ENTRIES}` : LOOPBACK_ENTRIES
    process.env.NO_PROXY = applied
    process.env.no_proxy = applied
    leaseState.snapshot = snapshot
    leaseState.applied = applied
  }

  leaseState.count += 1
  let released = false

  return () => {
    if (released) return
    released = true
    leaseState.count -= 1
    if (leaseState.count > 0) return
    if (!leaseState.snapshot) return

    const untouched = process.env.NO_PROXY === leaseState.applied && process.env.no_proxy === leaseState.applied
    if (untouched) {
      if (leaseState.snapshot.NO_PROXY !== undefined) {
        process.env.NO_PROXY = leaseState.snapshot.NO_PROXY
      } else {
        delete process.env.NO_PROXY
      }
      if (leaseState.snapshot.no_proxy !== undefined) {
        process.env.no_proxy = leaseState.snapshot.no_proxy
      } else {
        delete process.env.no_proxy
      }
    }

    leaseState.snapshot = null
    leaseState.applied = null
  }
}
