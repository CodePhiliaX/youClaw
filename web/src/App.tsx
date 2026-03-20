import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { Chat } from './pages/Chat'
import { Agents } from './pages/Agents'
import { Memory } from './pages/Memory'
import { Tasks } from './pages/Tasks'
import { Logs } from './pages/Logs'
import { Skills } from './pages/Skills'
import { Login } from './pages/Login'
import { GitSetup } from './pages/GitSetup'
import { PortConflictDialog } from './components/PortConflictDialog'
import { CloseConfirmDialog } from './components/CloseConfirmDialog'
import { useTheme } from './hooks/useTheme'
import { useAppStore } from './stores/app'
import { getTauriInvoke, isTauri, updateCachedBaseUrl } from './api/transport'
import { saveAuthToken } from './api/client'

function AuthGuard() {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn)
  const cloudEnabled = useAppStore((s) => s.cloudEnabled)
  // Offline mode does not require login
  if (!cloudEnabled || isLoggedIn) return <Shell><Outlet /></Shell>
  return <Navigate to="/login" replace />
}

function maskToken(token: string | null): string {
  if (!token) return '(none)'
  return `${token.slice(0, 6)}... (len=${token.length})`
}

// Tauri devUrl uses http protocol, so BrowserRouter works directly
export default function App() {
  useTheme()
  const isLoggedIn = useAppStore((s) => s.isLoggedIn)
  const cloudEnabled = useAppStore((s) => s.cloudEnabled)
  const gitAvailable = useAppStore((s) => s.gitAvailable)
  const fetchUser = useAppStore((s) => s.fetchUser)
  const fetchCreditBalance = useAppStore((s) => s.fetchCreditBalance)
  const canPass = !cloudEnabled || isLoggedIn
  const [portConflict, setPortConflict] = useState(false)
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)

  // Persistently listen for sidecar-event (Tauri mode)
  useEffect(() => {
    if (!isTauri) return
    let cleanup: (() => void) | null = null

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ status: string; message: string }>('sidecar-event', (event) => {
        if (event.payload.status === 'ready') {
          const match = event.payload.message.match(/port\s+(\d+)/)
          if (match) {
            updateCachedBaseUrl(`http://localhost:${match[1]}`)
          }
          // Re-hydrate if initial hydrate failed (e.g. backend wasn't ready yet)
          const { modelReady, hydrate } = useAppStore.getState()
          if (!modelReady) {
            hydrate()
          }
        } else if (event.payload.status === 'port-conflict') {
          setPortConflict(true)
        }
      }).then(fn => { cleanup = fn })
    })

    return () => { cleanup?.() }
  }, [])

  useEffect(() => {
    if (!isTauri) return
    let cleanup: (() => void) | null = null

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('close-requested', () => {
        setCloseDialogOpen(true)
      }).then((fn) => {
        cleanup = fn
      })
    })

    return () => {
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    if (!isTauri) return

    let unlisten: (() => void) | null = null
    const inFlightUrls = new Set<string>()

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const normalizeDeepLink = (rawUrl: string) => {
      const start = rawUrl.indexOf('youclaw://')
      if (start === -1) return null
      const normalized = rawUrl
        .slice(start)
        .trim()
        .replace(/^['"]+/, '')
        .replace(/['"]+$/, '')
      return normalized.startsWith('youclaw://') ? normalized : null
    }

    const logDeepLink = (stage: string, details: Record<string, unknown>) => {
      console.info('[auth deep-link]', stage, details)
    }

    const persistAuthTokenWithRetry = async (token: string) => {
      let lastError: unknown = null
      for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
          logDeepLink('save-token:start', { attempt: attempt + 1, tokenPreview: maskToken(token) })
          await saveAuthToken(token)
          logDeepLink('save-token:success', { attempt: attempt + 1, tokenPreview: maskToken(token) })
          return
        } catch (err) {
          lastError = err
          logDeepLink('save-token:retry', {
            attempt: attempt + 1,
            tokenPreview: maskToken(token),
            error: err instanceof Error ? err.message : String(err),
          })
          await delay(500)
        }
      }
      throw lastError ?? new Error('Failed to persist auth token from deep link')
    }

    const handleDeepLink = async (rawUrl: string) => {
      const normalizedUrl = normalizeDeepLink(rawUrl)
      if (!normalizedUrl || inFlightUrls.has(normalizedUrl)) return
      inFlightUrls.add(normalizedUrl)

      let url: URL
      try {
        url = new URL(normalizedUrl)
      } catch {
        inFlightUrls.delete(normalizedUrl)
        return
      }

      if (url.protocol !== 'youclaw:') {
        inFlightUrls.delete(normalizedUrl)
        return
      }

      const route = `${url.hostname}${url.pathname}`
      const token = url.searchParams.get('token')
      logDeepLink('received', {
        route,
        hasToken: !!token,
        tokenPreview: maskToken(token),
      })

      if (route === 'auth/callback') {
        if (!token) {
          logDeepLink('auth-callback:missing-token', { route })
          inFlightUrls.delete(normalizedUrl)
          return
        }
        try {
          await persistAuthTokenWithRetry(token)
          logDeepLink('auth-callback:fetch-user', { route, tokenPreview: maskToken(token) })
          await fetchUser()
          await fetchCreditBalance()
        } catch (err) {
          console.error('Failed to persist auth token from deep link:', err)
          logDeepLink('auth-callback:error', {
            route,
            tokenPreview: maskToken(token),
            error: err instanceof Error ? err.message : String(err),
          })
        } finally {
          inFlightUrls.delete(normalizedUrl)
        }
        return
      }

      if (route === 'pay/callback' && url.searchParams.get('status') === 'success') {
        void fetchCreditBalance()
      }

      inFlightUrls.delete(normalizedUrl)
    }

    const invoke = getTauriInvoke()

    const setDeepLinkFrontendReady = async (ready: boolean) => {
      try {
        await invoke('set_deep_link_frontend_ready', { ready })
        logDeepLink('frontend-ready', { ready })
      } catch (err) {
        console.error(`Failed to set deep-link frontend readiness to ${ready}:`, err)
      }
    }

    const loadPendingDeepLinks = async () => {
      try {
        const urls = await invoke('take_pending_deep_links') as string[]
        logDeepLink('pending-links', { count: urls?.length ?? 0 })
        for (const url of urls ?? []) {
          await handleDeepLink(url)
        }
      } catch (err) {
        console.error('Failed to load pending deep links:', err)
      }
    }

    let disposed = false

    const initializeDeepLinks = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        const stopListening = await listen<string>('deep-link-received', (event) => {
          void handleDeepLink(event.payload)
        })

        if (disposed) {
          stopListening()
          return
        }

        unlisten = stopListening
        await setDeepLinkFrontendReady(true)
        await loadPendingDeepLinks()
      } catch (err) {
        console.error('Failed to initialize deep-link bridge:', err)
      }
    }

    void initializeDeepLinks()
    // Intentionally avoid replaying plugin `getCurrent()` URLs here.
    // In Tauri, that value can survive a webview refresh and re-deliver the
    // last `youclaw://auth/callback?...` URL, which would silently restore a
    // logged-out session after the user reloads the page.

    return () => {
      disposed = true
      void setDeepLinkFrontendReady(false)
      unlisten?.()
    }
  }, [fetchCreditBalance, fetchUser])

  // Block all pages until Git is available (Windows only)
  if (!gitAvailable) {
    return <GitSetup />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={canPass ? <Navigate to="/" replace /> : <Login />} />
        <Route element={<AuthGuard />}>
          <Route path="/" element={<Chat />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/cron" element={<Tasks />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/logs" element={<Logs />} />
        </Route>
        <Route path="*" element={<Navigate to={canPass ? "/" : "/login"} replace />} />
      </Routes>
      {isTauri && <PortConflictDialog open={portConflict} onResolved={() => setPortConflict(false)} />}
      {isTauri && <CloseConfirmDialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen} />}
    </BrowserRouter>
  )
}
