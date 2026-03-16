// Transport abstraction layer: auto-detect Tauri / Web environment

export const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__

export function getTauriInvoke(): (cmd: string, args?: Record<string, unknown>) => Promise<unknown> {
  if (!isTauri) throw new Error("Not in Tauri environment")
  return (window as any).__TAURI_INTERNALS__.invoke
}

// Cache backend baseUrl to avoid repeated store reads
let _cachedBaseUrl: string | null = null

// Port conflict status
let _portConflict: string | null = null

export function getPortConflict(): string | null {
  return _portConflict
}

export function clearPortConflict(): void {
  _portConflict = null
}

export function updateCachedBaseUrl(url: string): void {
  _cachedBaseUrl = url
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
    window.open(url, '_blank')
  }
}

/** Called once at app startup, waits for sidecar ready event before rendering */
export async function initBaseUrl(): Promise<void> {
  if (!isTauri) return

  // Quick-read port from store first
  await getBackendBaseUrl()

  // Wait for Rust-side sidecar-event: ready, then update port cache
  try {
    const { listen } = await import('@tauri-apps/api/event')
    await new Promise<void>((resolve) => {
      const unlisten = listen<{ status: string; message: string }>('sidecar-event', (event) => {
        if (event.payload.status === 'ready') {
          const match = event.payload.message.match(/port\s+(\d+)/)
          if (match) {
            _cachedBaseUrl = `http://localhost:${match[1]}`
          }
          unlisten.then(fn => fn())
          resolve()
        } else if (event.payload.status === 'port-conflict') {
          _portConflict = event.payload.message
          unlisten.then(fn => fn())
          resolve()
        } else if (event.payload.status === 'error') {
          // Backend failed to start, don't block frontend, use existing port as fallback
          unlisten.then(fn => fn())
          resolve()
        }
      })

      // Fallback timeout: ready event may have fired before listener was set up
      setTimeout(resolve, 5000)
    })
  } catch {
    // Listener failure doesn't block startup
  }
}
