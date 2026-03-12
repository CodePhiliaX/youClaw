import { type ReactNode, useState } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { SettingsDialog } from '@/components/settings/SettingsDialog'

export function Shell({ children }: { children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false)

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
