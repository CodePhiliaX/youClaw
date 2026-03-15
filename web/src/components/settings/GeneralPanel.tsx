import { useState } from "react"
import { useI18n } from "@/i18n"
import { useAppStore } from "@/stores/app"
import { isTauri } from "@/api/transport"
import type { Theme } from "@/hooks/useTheme"
import { Sun, Moon, Monitor } from "lucide-react"
import { cn } from "@/lib/utils"

const themeOptions: { value: Theme; labelKey: "dark" | "light" | "system"; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { value: "light", labelKey: "light", icon: Sun },
  { value: "dark", labelKey: "dark", icon: Moon },
  { value: "system", labelKey: "system", icon: Monitor },
]

const languageOptions = [
  { value: "en", label: "English (US)" },
  { value: "zh", label: "简体中文" },
] as const

export function GeneralPanel() {
  const { t } = useI18n()
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const locale = useAppStore((s) => s.locale)
  const setLocale = useAppStore((s) => s.setLocale)
  const preferredPort = useAppStore((s) => s.preferredPort)
  const portConflict = useAppStore((s) => s.portConflict)
  const setPreferredPort = useAppStore((s) => s.setPreferredPort)
  const restartBackend = useAppStore((s) => s.restartBackend)

  const [portInput, setPortInput] = useState(preferredPort ?? '')
  const [portSaved, setPortSaved] = useState(false)
  const [portRestarting, setPortRestarting] = useState(false)

  const handleSavePort = async () => {
    const value = portInput.trim()
    if (value) {
      const num = parseInt(value)
      if (isNaN(num) || num < 1024 || num > 65535) return
      await setPreferredPort(String(num))
    } else {
      await setPreferredPort(null)
    }
    setPortSaved(true)
    setTimeout(() => setPortSaved(false), 5000)
  }

  const handleRestart = async () => {
    setPortRestarting(true)
    try {
      await restartBackend()
    } finally {
      setPortRestarting(false)
    }
  }

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

      {/* 服务端口 */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          {t.settings.serverPort}
        </h4>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <input
              data-testid="port-input"
              type="number"
              min={1024}
              max={65535}
              placeholder="23107"
              value={portInput}
              onChange={(e) => { setPortInput(e.target.value); setPortSaved(false) }}
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-sm focus:border-primary focus:outline-none transition-colors"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t.settings.portHint}
            </p>
          </div>
          <button
            data-testid="port-save-btn"
            onClick={handleSavePort}
            className="px-6 py-3 rounded-xl border-2 border-primary bg-primary/10 text-sm font-medium text-foreground hover:bg-primary/20 transition-colors"
          >
            {t.settings.portSave}
          </button>
        </div>

        {portSaved && (
          <div data-testid="port-saved-hint" className="mt-3 flex items-center gap-3">
            <span className="text-sm text-green-600">
              {isTauri ? t.settings.portSaved : t.settings.portWebHint}
            </span>
            {isTauri && (
              <button
                onClick={handleRestart}
                disabled={portRestarting}
                className="px-4 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                {portRestarting ? t.settings.portRestarting : t.settings.portRestartNow}
              </button>
            )}
          </div>
        )}

        {portConflict && (
          <div data-testid="port-conflict-alert" className="mt-3 p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
            {portConflict}
          </div>
        )}
      </div>
    </div>
  )
}
