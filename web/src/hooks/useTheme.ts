import { useEffect } from "react"
import { useAppStore } from "@/stores/app"

export type Theme = "dark" | "light" | "system"

export function applyThemeToDOM(theme: Theme): void {
  const body = document.body

  // Disable all transitions during switch to prevent color gradient desync
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

  // Restore transitions on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.head.removeChild(style)
      document.documentElement.style.removeProperty("--disable-transitions")
    })
  })
}

// Theme initialization hook (used in App root component)
export function useTheme(): void {
  const theme = useAppStore((s) => s.theme)

  useEffect(() => {
    applyThemeToDOM(theme)
  }, [theme])

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      const current = useAppStore.getState().theme
      if (current === "system") {
        applyThemeToDOM("system")
      }
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
}
