import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { Chat } from './pages/Chat'
import { Agents } from './pages/Agents'
import { Memory } from './pages/Memory'
import { Tasks } from './pages/Tasks'
import { Logs } from './pages/Logs'
import { Login } from './pages/Login'
import { GitSetup } from './pages/GitSetup'
import { PortConflictDialog } from './components/PortConflictDialog'
import { useTheme } from './hooks/useTheme'
import { useAppStore } from './stores/app'
import { isTauri, updateCachedBaseUrl } from './api/transport'
import { saveAuthToken } from './api/client'

function AuthGuard() {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn)
  const cloudEnabled = useAppStore((s) => s.cloudEnabled)
  // Offline mode does not require login
  if (!cloudEnabled || isLoggedIn) return <Shell><Outlet /></Shell>
  return <Navigate to="/login" replace />
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
        } else if (event.payload.status === 'port-conflict') {
          setPortConflict(true)
        }
      }).then(fn => { cleanup = fn })
    })

    return () => { cleanup?.() }
  }, [])

  useEffect(() => {
    if (!isTauri) return

    let unlisten: (() => void) | null = null
    const handledUrls = new Set<string>()
    const inFlightUrls = new Set<string>()

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const persistAuthTokenWithRetry = async (token: string) => {
      let lastError: unknown = null
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          await saveAuthToken(token)
          return
        } catch (err) {
          lastError = err
          await delay(500)
        }
      }
      throw lastError ?? new Error('Failed to persist auth token from deep link')
    }

    const handleDeepLink = async (rawUrl: string) => {
      if (!rawUrl || handledUrls.has(rawUrl) || inFlightUrls.has(rawUrl)) return
      inFlightUrls.add(rawUrl)

      let url: URL
      try {
        url = new URL(rawUrl)
      } catch {
        inFlightUrls.delete(rawUrl)
        return
      }

      if (url.protocol !== 'youclaw:') {
        inFlightUrls.delete(rawUrl)
        return
      }

      const route = `${url.hostname}${url.pathname}`
      if (route === 'auth/callback') {
        const token = url.searchParams.get('token')
        if (!token) {
          inFlightUrls.delete(rawUrl)
          return
        }
        try {
          await persistAuthTokenWithRetry(token)
          handledUrls.add(rawUrl)
          await fetchUser()
          await fetchCreditBalance()
        } catch (err) {
          console.error('Failed to persist auth token from deep link:', err)
        } finally {
          inFlightUrls.delete(rawUrl)
        }
        return
      }

      if (route === 'pay/callback' && url.searchParams.get('status') === 'success') {
        handledUrls.add(rawUrl)
        void fetchCreditBalance()
      }

      inFlightUrls.delete(rawUrl)
    }

    void import('@tauri-apps/plugin-deep-link').then(async ({ getCurrent }) => {
      const urls = await getCurrent().catch(() => null)
      for (const url of urls ?? []) {
        await handleDeepLink(url)
      }
    })

    void import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('deep-link-received', (event) => {
        void handleDeepLink(event.payload)
      }).then((fn) => {
        unlisten = fn
      })
    })

    return () => {
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
          <Route path="/memory" element={<Memory />} />
          <Route path="/logs" element={<Logs />} />
        </Route>
        <Route path="*" element={<Navigate to={canPass ? "/" : "/login"} replace />} />
      </Routes>
      {isTauri && <PortConflictDialog open={portConflict} onResolved={() => setPortConflict(false)} />}
    </BrowserRouter>
  )
}
