import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { Chat } from './pages/Chat'
import { Agents } from './pages/Agents'
import { Skills } from './pages/Skills'
import { Memory } from './pages/Memory'
import { Tasks } from './pages/Tasks'
import { System } from './pages/System'
import { Logs } from './pages/Logs'
import { BrowserProfiles } from './pages/BrowserProfiles'
import { useTheme } from './hooks/useTheme'

// Tauri devUrl 是 http 协议，可以直接用 BrowserRouter
export default function App() {
  useTheme()

  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/cron" element={<Tasks />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/browser" element={<BrowserProfiles />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/system" element={<System />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  )
}
