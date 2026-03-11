import { useEffect, useState } from "react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { applyThemeToDOM, getSavedTheme, saveTheme, type Theme } from "@/hooks/useTheme"
import { useI18n } from "@/i18n"

const themeOptions: { value: Theme; labelKey: "dark" | "light" | "system"; descKey: "darkDesc" | "lightDesc" | "systemDesc" }[] = [
  { value: "dark", labelKey: "dark", descKey: "darkDesc" },
  { value: "light", labelKey: "light", descKey: "lightDesc" },
  { value: "system", labelKey: "system", descKey: "systemDesc" },
]

export function GeneralPanel() {
  const { t } = useI18n()
  const [theme, setTheme] = useState<Theme>("system")

  useEffect(() => {
    getSavedTheme().then(setTheme)
  }, [])

  const handleThemeChange = (value: string) => {
    const newTheme = value as Theme
    setTheme(newTheme)
    saveTheme(newTheme)
    applyThemeToDOM(newTheme)
  }

  return (
    <div className="pt-4">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">
        {t.settings.appearance}
      </h3>
      <RadioGroup value={theme} onValueChange={handleThemeChange}>
        {themeOptions.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-accent"
          >
            <RadioGroupItem value={option.value} />
            <div>
              <Label className="text-sm font-medium cursor-pointer">
                {t.settings[option.labelKey]}
              </Label>
              <div className="text-xs text-muted-foreground">{t.settings[option.descKey]}</div>
            </div>
          </label>
        ))}
      </RadioGroup>
    </div>
  )
}
