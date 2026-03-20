// Transport abstraction layer: auto-detect Tauri / Web environment

type TauriInternals = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
}

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals
}

function getTauriInternals(): TauriInternals | undefined {
  return (window as TauriWindow).__TAURI_INTERNALS__
}

export const isTauri = typeof window !== "undefined" && !!getTauriInternals()

/**
 * Convert a local file path to a URL loadable by the webview.
 * Uses Tauri's asset protocol when available, falls back to file:// URL.
 */
export function localAssetUrl(filePath: string): string {
  if (isTauri) {
    // Tauri 2 asset protocol: identical to convertFileSrc() from @tauri-apps/api/core
    const encoded = encodeURIComponent(filePath)
    return navigator.userAgent.includes('Windows')
      ? `http://asset.localhost/${encoded}`
      : `asset://localhost/${encoded}`
  }
  return `file://${filePath}`
}

export function getTauriInvoke(): (cmd: string, args?: Record<string, unknown>) => Promise<unknown> {
  if (!isTauri) throw new Error("Not in Tauri environment")
  return getTauriInternals()!.invoke
}

// Cache backend baseUrl to avoid repeated store reads
let _cachedBaseUrl: string | null = null

export function updateCachedBaseUrl(url: string): void {
  _cachedBaseUrl = url
}

/**
 * Persist preferred port to Tauri Store (JS instance only).
 * Must not go through the Rust app.store() to avoid cache divergence.
 */
export async function savePreferredPort(port: number): Promise<void> {
  if (port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535')
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load('settings.json')
  await store.set('preferred_port', String(port))
  await store.save()
}

/**
 * Get backend baseUrl
 * - Tauri mode: read port from store, default 62601
 * - Web mode: empty string (uses Vite proxy)
 */
export async function getBackendBaseUrl(): Promise<string> {
  if (!isTauri) return ''
  if (_cachedBaseUrl !== null) return _cachedBaseUrl

  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load('settings.json')
    const port = (await store.get<string>('preferred_port')) || '62601'
    _cachedBaseUrl = `http://localhost:${port}`
  } catch {
    _cachedBaseUrl = 'http://localhost:62601'
  }
  return _cachedBaseUrl
}

/**
 * Get baseUrl synchronously (for EventSource and other non-async scenarios)
 * Must call initBaseUrl() first
 */
export function getBaseUrlSync(): string {
  if (!isTauri) return ''
  return _cachedBaseUrl ?? 'http://localhost:62601'
}

/**
 * Open a URL in the system default browser.
 * Tauri mode: uses @tauri-apps/plugin-opener
 * Web mode: falls back to window.open
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/** Called once at app startup, polls backend health until ready before rendering */
export async function initBaseUrl(): Promise<boolean> {
  if (!isTauri) return true

  // Quick-read port from store first
  await getBackendBaseUrl()

  // Poll backend health endpoint directly — no Rust IPC middleman
  const maxWait = 30000
  const interval = 300
  for (let elapsed = 0; elapsed < maxWait; elapsed += interval) {
    try {
      const res = await fetch(`${_cachedBaseUrl}/api/health`, { signal: AbortSignal.timeout(500) })
      if (res.ok) return true
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, interval))
  }
  return false
}
