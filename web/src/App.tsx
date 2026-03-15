import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { Chat } from './pages/Chat'
import { Agents } from './pages/Agents'
import { Memory } from './pages/Memory'
import { Tasks } from './pages/Tasks'
import { Login } from './pages/Login'
import { useTheme } from './hooks/useTheme'
import { useAppStore } from './stores/app'
import { useI18n } from './i18n'
import { isTauri, updateCachedBaseUrl } from './api/transport'

function AuthGuard() {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn)
  const cloudEnabled = useAppStore((s) => s.cloudEnabled)
  // Offline mode does not require login
  if (!cloudEnabled || isLoggedIn) return <Shell><Outlet /></Shell>
  return <Navigate to="/login" replace />
}

function PortConflictDialog() {
  const { t } = useI18n()
  const portConflict = useAppStore((s) => s.portConflict)
  const clearPortConflict = useAppStore((s) => s.clearPortConflict)

  if (!portConflict) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-2xl border shadow-lg p-6 max-w-md mx-4 space-y-4">
        <h3 className="text-lg font-semibold">{t.settings.portConflictTitle}</h3>
        <p className="text-sm text-muted-foreground">{portConflict}</p>
        <p className="text-sm text-muted-foreground">{t.settings.portConflictHint}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={clearPortConflict}
            className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            {t.common.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}

// Tauri devUrl uses http protocol, so BrowserRouter works directly
export default function App() {
  useTheme()
  const isLoggedIn = useAppStore((s) => s.isLoggedIn)
  const cloudEnabled = useAppStore((s) => s.cloudEnabled)
  const canPass = !cloudEnabled || isLoggedIn

  // 持久监听 sidecar-event（Tauri 模式）
  useEffect(() => {
    if (!isTauri) return
    let cleanup: (() => void) | null = null

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ status: string; message: string }>('sidecar-event', (event) => {
        if (event.payload.status === 'port-conflict') {
          useAppStore.setState({ portConflict: event.payload.message })
        } else if (event.payload.status === 'ready') {
          const match = event.payload.message.match(/port\s+(\d+)/)
          if (match) {
            updateCachedBaseUrl(`http://localhost:${match[1]}`)
          }
          useAppStore.setState({ portConflict: null })
        }
      }).then(fn => { cleanup = fn })
    })

    return () => { cleanup?.() }
  }, [])

  return (
    <BrowserRouter>
      <PortConflictDialog />
      <Routes>
        <Route path="/login" element={canPass ? <Navigate to="/" replace /> : <Login />} />
        <Route element={<AuthGuard />}>
          <Route path="/" element={<Chat />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/cron" element={<Tasks />} />
          <Route path="/memory" element={<Memory />} />
        </Route>
        <Route path="*" element={<Navigate to={canPass ? "/" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
