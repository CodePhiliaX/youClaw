import { type ReactNode, useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { isElectron, getElectronAPI } from '@/api/transport'

export function Shell({ children }: { children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Electron：监听菜单栏 Cmd+, 打开设置
  useEffect(() => {
    if (!isElectron) return
    const cleanup = getElectronAPI().onOpenSettings(() => setSettingsOpen(true))
    return cleanup
  }, [])

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <Topbar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
