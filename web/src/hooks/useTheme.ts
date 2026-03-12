import { useEffect } from "react"
import { isTauri } from "@/api/transport"

export type Theme = "dark" | "light" | "system"

const THEME_KEY = "youclaw-theme"

export function applyThemeToDOM(theme: Theme): void {
  const body = document.body

  // 切换时禁用所有 transition，避免颜色渐变不同步
  document.documentElement.style.setProperty("--disable-transitions", "1")
  const style = document.createElement("style")
  style.textContent = "*, *::before, *::after { transition-duration: 0s !important; }"
  document.head.appendChild(style)

  if (theme === "system") {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    body.classList.toggle("dark", systemDark)
  } else if (theme === "dark") {
    body.classList.add("dark")
  } else {
    body.classList.remove("dark")
  }

  // 下一帧恢复 transition
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.head.removeChild(style)
      document.documentElement.style.removeProperty("--disable-transitions")
    })
  })
}

// 获取保存的主题
export async function getSavedTheme(): Promise<Theme> {
  if (isTauri) {
    try {
      const { load } = await import("@tauri-apps/plugin-store")
      const store = await load("settings.json")
      const theme = await store.get<string>("theme")
      return (theme as Theme) ?? "system"
    } catch {
      return "system"
    }
  }
  return (localStorage.getItem(THEME_KEY) as Theme) ?? "system"
}

// 保存主题
export async function saveTheme(theme: Theme): Promise<void> {
  if (isTauri) {
    try {
      const { load } = await import("@tauri-apps/plugin-store")
      const store = await load("settings.json")
      await store.set("theme", theme)
      await store.save()
    } catch {}
    return
  }
  localStorage.setItem(THEME_KEY, theme)
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
