import { type ReactNode, useState, useEffect } from 'react'
import { AppSidebar } from './AppSidebar'
import { SidebarProvider } from '@/hooks/useSidebar'
import { ChatProvider } from '@/hooks/useChatContext'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { isTauri } from '@/api/transport'

export function Shell({ children }: { children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [platform, setPlatform] = useState('')

  useEffect(() => {
    if (!isTauri) return
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<string>('get_platform').then(setPlatform)
    })
  }, [])

  const isWin = platform === 'windows'

  return (
    <ChatProvider>
      <SidebarProvider>
        <div className="h-screen flex bg-background text-foreground">
          <AppSidebar onOpenSettings={() => setSettingsOpen(true)} />
          <main className="flex-1 overflow-hidden flex flex-col">
            {/* Windows: drag region 条 */}
            {isWin && (
              <div
                className="h-8 shrink-0 flex justify-end"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
              >
                <div className="w-32 shrink-0" />
              </div>
            )}
            <div className="flex-1 overflow-hidden">
              {children}
            </div>
          </main>
        </div>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </SidebarProvider>
    </ChatProvider>
  )
}
