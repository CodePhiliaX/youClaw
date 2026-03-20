import { type ReactNode, useState, useEffect } from 'react'
import { AppSidebar } from './AppSidebar'
import { ChatProvider } from '@/hooks/useChatContext'
import { SettingsDialog, type SettingsTab } from '@/components/settings/SettingsDialog'
import { isTauri } from '@/api/transport'
import { PlatformContext } from '@/hooks/usePlatform'
import { useDragRegion } from '@/hooks/useDragRegion'

function MacTitleBar() {
  const drag = useDragRegion()
  return (
    <div
      className="h-[30px] shrink-0 flex items-center justify-center bg-muted/30 border-b border-[var(--subtle-border)]"
      {...drag}
    >
      <span className="text-xs font-semibold text-foreground/60">YouClaw</span>
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>()
  const [platform, setPlatform] = useState('')

  useEffect(() => {
    if (!isTauri) return
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<string>('get_platform').then(setPlatform)
    })
  }, [])

  const isWin = platform === 'windows'
  const isMac = platform === 'macos'
  const isDesktop = isTauri

  const platformCtx = { platform, isMac, isWin, isDesktop }

  return (
    <PlatformContext.Provider value={platformCtx}>
      <ChatProvider>
        <div className="h-screen flex flex-col bg-background text-foreground">
          {isMac && <MacTitleBar />}
          <div className="flex-1 flex overflow-hidden">
            <AppSidebar onOpenSettings={(tab) => { setSettingsTab(tab as SettingsTab); setSettingsOpen(true) }} />
            <main className="flex-1 overflow-hidden flex flex-col">
              {children}
            </main>
          </div>
        </div>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialTab={settingsTab} />
      </ChatProvider>
    </PlatformContext.Provider>
  )
}
