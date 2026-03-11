import { useEffect } from "react"
import { isElectron, getElectronAPI } from "@/api/transport"

export type Theme = "dark" | "light" | "system"

const THEME_KEY = "youclaw-theme"

export function applyThemeToDOM(theme: Theme): void {
  const html = document.documentElement
  if (theme === "system") {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    html.classList.toggle("dark", systemDark)
  } else if (theme === "dark") {
    html.classList.add("dark")
  } else {
    html.classList.remove("dark")
  }
}

// 获取保存的主题
export async function getSavedTheme(): Promise<Theme> {
  if (isElectron) {
    return getElectronAPI().getTheme() as Promise<Theme>
  }
  return (localStorage.getItem(THEME_KEY) as Theme) ?? "system"
}

// 保存主题
export async function saveTheme(theme: Theme): Promise<void> {
  if (isElectron) {
    await getElectronAPI().setTheme(theme)
  } else {
    localStorage.setItem(THEME_KEY, theme)
  }
}

// 初始化主题的 hook（在 App 根组件使用）
export function useTheme(): void {
  useEffect(() => {
    getSavedTheme().then((theme) => {
      applyThemeToDOM(theme)
    })

    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      getSavedTheme().then((theme) => {
        if (theme === "system") {
          applyThemeToDOM("system")
        }
      })
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
}
