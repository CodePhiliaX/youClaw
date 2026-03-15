import { useI18n } from "@/i18n"
import { useAppStore } from "@/stores/app"
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
    </div>
  )
}
