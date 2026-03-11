import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import { Chat } from './pages/Chat'
import { Agents } from './pages/Agents'
import { Skills } from './pages/Skills'
import { Memory } from './pages/Memory'
import { Tasks } from './pages/Tasks'
import { System } from './pages/System'
import { useTheme } from './hooks/useTheme'
import { isElectron } from './api/transport'

// Electron 使用 HashRouter（file:// 协议不支持 BrowserRouter）
const Router = isElectron ? HashRouter : BrowserRouter

export default function App() {
  useTheme()

  return (
    <Router>
      <Shell>
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/cron" element={<Tasks />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/system" element={<System />} />
        </Routes>
      </Shell>
    </Router>
  )
}
