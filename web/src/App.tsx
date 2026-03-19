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

    const handleDeepLink = async (rawUrl: string) => {
      if (!rawUrl || handledUrls.has(rawUrl)) return
      handledUrls.add(rawUrl)

      let url: URL
      try {
        url = new URL(rawUrl)
      } catch {
        return
      }

      if (url.protocol !== 'youclaw:') return

      const route = `${url.hostname}${url.pathname}`
      if (route === 'auth/callback') {
        const token = url.searchParams.get('token')
        if (!token) return
        try {
          await saveAuthToken(token)
          await fetchUser()
          await fetchCreditBalance()
        } catch (err) {
          console.error('Failed to persist auth token from deep link:', err)
        }
        return
      }

      if (route === 'pay/callback' && url.searchParams.get('status') === 'success') {
        void fetchCreditBalance()
      }
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
