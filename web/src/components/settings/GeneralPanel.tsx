import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '@/i18n'
import { useAppStore, type CloseAction } from '@/stores/app'
import type { Theme } from '@/hooks/useTheme'
import { Sun, Moon, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getTauriInvoke, isTauri, updateCachedBaseUrl, savePreferredPort } from '@/api/transport'

const themeOptions: { value: Theme; labelKey: 'dark' | 'light' | 'system'; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { value: 'light', labelKey: 'light', icon: Sun },
  { value: 'dark', labelKey: 'dark', icon: Moon },
  { value: 'system', labelKey: 'system', icon: Monitor },
]

const languageOptions = [
  { value: 'en', label: 'English (US)' },
  { value: 'zh', label: '简体中文' },
] as const

const closeBehaviorOptions: { value: CloseAction; titleKey: 'closeBehaviorAsk' | 'closeBehaviorMinimize' | 'closeBehaviorQuit'; descriptionKey: 'closeBehaviorAskDesc' | 'closeBehaviorMinimizeDesc' | 'closeBehaviorQuitDesc' }[] = [
  { value: '', titleKey: 'closeBehaviorAsk', descriptionKey: 'closeBehaviorAskDesc' },
  { value: 'minimize', titleKey: 'closeBehaviorMinimize', descriptionKey: 'closeBehaviorMinimizeDesc' },
  { value: 'quit', titleKey: 'closeBehaviorQuit', descriptionKey: 'closeBehaviorQuitDesc' },
]

export function GeneralPanel() {
  const { t } = useI18n()
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const locale = useAppStore((s) => s.locale)
  const setLocale = useAppStore((s) => s.setLocale)
  const closeAction = useAppStore((s) => s.closeAction)
  const setCloseAction = useAppStore((s) => s.setCloseAction)

  // Port config state (Tauri only)
  const [portValue, setPortValue] = useState('62601')
  const [portSaved, setPortSaved] = useState(false)
  const [portRestarting, setPortRestarting] = useState(false)
  const [portMessage, setPortMessage] = useState('')

  // Load preferred_port from Tauri Store on mount
  useEffect(() => {
    if (!isTauri) return
    import('@tauri-apps/plugin-store').then(({ load }) => {
      load('settings.json').then(async (store) => {
        const preferred = await store.get<string>('preferred_port')
        if (preferred) setPortValue(preferred)
      })
    }).catch(() => {})
  }, [])

  const savePortToStore = useCallback(async (port: number) => {
    await savePreferredPort(port)
  }, [])

  const handleSavePort = useCallback(async () => {
    const port = parseInt(portValue, 10)
    if (isNaN(port) || port < 1024 || port > 65535) return
    try {
      await savePortToStore(port)
      setPortSaved(true)
      setPortMessage('')
      setTimeout(() => setPortSaved(false), 3000)
    } catch (err) {
      console.error('Failed to save port:', err)
    }
  }, [portValue, savePortToStore])

  const handleRestartSidecar = useCallback(async () => {
    const port = parseInt(portValue, 10)
    if (isNaN(port) || port < 1024 || port > 65535) return
    setPortRestarting(true)
    setPortMessage('')
    try {
      // Save port first, then restart
      await savePortToStore(port)
      const invoke = getTauriInvoke()
      await invoke('restart_sidecar')
      updateCachedBaseUrl(`http://localhost:${port}`)
      // Reload to reconnect all SSE/API connections to new port
      window.location.reload()
    } catch (err) {
      // Dev mode or restart failure: update cache anyway, show hint
      const errMsg = String(err)
      updateCachedBaseUrl(`http://localhost:${port}`)
      setPortSaved(true)
      setPortRestarting(false)
      setPortMessage(errMsg.includes('Dev mode') ? t.settings.portWebHint : `Restart failed: ${errMsg}`)
    }
  }, [portValue, savePortToStore, t])

  return (
    <div className="space-y-8">
      {/* Theme */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          {t.settings.appearance}
        </h4>
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map((option) => {
            const Icon = option.icon
            return (
              <button
                key={option.value}
                onClick={() => setTheme(option.value)}
                className={cn(
                  "p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3",
                  theme === option.value
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/30"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center",
                  theme === option.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}>
                  <Icon size={20} />
                </div>
                <span className="text-xs font-medium capitalize">{t.settings[option.labelKey]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Language */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          {t.settings.language}
        </h4>
        <div className="flex gap-3">
          {languageOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setLocale(option.value)}
              className={cn(
                "px-6 py-3 rounded-xl border-2 text-sm font-medium transition-all",
                locale === option.value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-muted-foreground/30"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Server Port (Tauri only) */}
      {isTauri && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
            {t.settings.serverPort}
          </h4>
          <p className="text-xs text-muted-foreground mb-3">{t.settings.portHint}</p>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1024}
              max={65535}
              value={portValue}
              onChange={(e) => { setPortValue(e.target.value); setPortSaved(false); setPortMessage("") }}
              className="w-32 rounded-xl"
            />
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={handleSavePort}
              disabled={portSaved}
            >
              {portSaved ? t.settings.portSaved : t.settings.portSave}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={handleRestartSidecar}
              disabled={portRestarting}
            >
              {portRestarting ? t.settings.portRestarting : t.settings.portRestartNow}
            </Button>
          </div>
          {portMessage && (
            <p className="text-xs text-amber-500 mt-2">{portMessage}</p>
          )}
        </div>
      )}

      {isTauri && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
            {t.settings.closeBehavior}
          </h4>
          <p className="text-xs text-muted-foreground mb-4">{t.settings.closeBehaviorHint}</p>
          <div className="grid gap-3 md:grid-cols-3">
            {closeBehaviorOptions.map((option) => (
              <button
                key={option.titleKey}
                onClick={() => void setCloseAction(option.value)}
                className={cn(
                  'rounded-2xl border-2 p-4 text-left transition-all',
                  closeAction === option.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-muted-foreground/30'
                )}
              >
                <div className="text-sm font-medium text-foreground">
                  {t.settings[option.titleKey]}
                </div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">
                  {t.settings[option.descriptionKey]}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
