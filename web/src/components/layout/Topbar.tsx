import { Bot, Settings } from 'lucide-react'
import { useI18n } from '@/i18n'
import { isTauri } from '@/api/transport'
import { useEffect, useState } from 'react'

interface TopbarProps {
  onOpenSettings?: () => void
}

export function Topbar({ onOpenSettings }: TopbarProps) {
  const { locale, t, setLocale } = useI18n()
  const [platform, setPlatform] = useState<string>('')

  useEffect(() => {
    if (isTauri) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke<string>("get_platform").then(setPlatform)
      })
    }
  }, [])

  const isMac = platform === 'macos'
  const isWin = platform === 'windows'

  return (
    <header
      className="h-12 border-b border-border flex items-center px-4 shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      data-tauri-drag-region
    >
      {/* macOS: 给交通灯按钮留出空间 */}
      {isMac && <div className="w-20 shrink-0" />}

      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-primary" />
        <span className="font-semibold text-base">{t.topbar.title}</span>
      </div>

      <div
        className="ml-auto flex items-center gap-2 text-sm text-muted-foreground"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          {t.topbar.running}
        </span>
        <button
          type="button"
          onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
          className="ml-2 px-2 py-0.5 rounded border border-border text-xs font-medium hover:bg-accent transition-colors"
        >
          {locale === 'en' ? '中' : 'EN'}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="p-1.5 rounded hover:bg-accent transition-colors"
          title={t.settings.title}
        >
          <Settings className="h-4 w-4" />
        </button>
        {/* Windows: 给原生 titleBarOverlay 留出空间 */}
        {isWin && <div className="w-32 shrink-0" />}
      </div>
    </header>
  )
}
