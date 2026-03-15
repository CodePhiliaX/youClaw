import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { Chat } from './pages/Chat'
import { Agents } from './pages/Agents'
import { Memory } from './pages/Memory'
import { Tasks } from './pages/Tasks'
import { Login } from './pages/Login'
import { useTheme } from './hooks/useTheme'
import { useAppStore } from './stores/app'

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

  return (
    <BrowserRouter>
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
