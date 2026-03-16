import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { Chat } from './pages/Chat'
import { Agents } from './pages/Agents'
import { Memory } from './pages/Memory'
import { Tasks } from './pages/Tasks'
import { Logs } from './pages/Logs'
import { Login } from './pages/Login'
import { PortConflictDialog } from './components/PortConflictDialog'
import { useTheme } from './hooks/useTheme'
import { useAppStore } from './stores/app'
import { isTauri, updateCachedBaseUrl } from './api/transport'

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
