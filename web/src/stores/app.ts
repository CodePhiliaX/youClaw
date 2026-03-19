import { create } from "zustand"
import { getItem, setItem } from "@/lib/storage"
import { applyThemeToDOM, type Theme } from "@/hooks/useTheme"
import { getAuthUser, getAuthStatus, getAuthLoginUrl, authLogout, getCreditBalance, getPayUrl, updateProfile as apiUpdateProfile, getCloudStatus, getSettings, updateSettings, checkGit, type AuthUser } from "@/api/client"
import { isTauri } from "@/api/transport"
import type { Locale } from "@/i18n/context"

interface AppState {
  theme: Theme
  setTheme: (theme: Theme) => void

  locale: Locale
  setLocale: (locale: Locale) => void

  sidebarCollapsed: boolean
  toggleSidebar: () => void
  collapseSidebar: () => void
  expandSidebar: () => void

  // Cloud
  cloudEnabled: boolean

  // Git
  gitAvailable: boolean
  gitChecked: boolean
  recheckGit: () => Promise<boolean>

  // Model
  modelReady: boolean

  // Auth
  user: AuthUser | null
  isLoggedIn: boolean
  authLoading: boolean
  fetchUser: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
  updateProfile: (params: { displayName?: string; avatar?: string }) => Promise<void>

  // Credits
  creditBalance: number | null
  fetchCreditBalance: () => Promise<void>
  openPayPage: () => Promise<void>

  hydrate: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  theme: "system",
  setTheme: (theme) => {
    set({ theme })
    applyThemeToDOM(theme)
    setItem("theme", theme)
  },

  locale: "en",
  setLocale: (locale) => {
    set({ locale })
    setItem("locale", locale)
  },

  sidebarCollapsed: false,
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    set({ sidebarCollapsed: next })
    setItem("sidebar-collapsed", String(next))
  },
  collapseSidebar: () => {
    set({ sidebarCollapsed: true })
    setItem("sidebar-collapsed", "true")
  },
  expandSidebar: () => {
    set({ sidebarCollapsed: false })
    setItem("sidebar-collapsed", "false")
  },

  // Cloud
  cloudEnabled: false,

  // Git
  gitAvailable: true, // default true, only set false on Windows when check fails
  gitChecked: false,

  recheckGit: async () => {
    try {
      const { available } = await checkGit()
      set({ gitAvailable: available, gitChecked: true })
      return available
    } catch {
      // Backend not ready, assume available
      set({ gitAvailable: true, gitChecked: true })
      return true
    }
  },

  // Model
  modelReady: false,

  // Auth
  user: null,
  isLoggedIn: false,
  authLoading: false,

  fetchUser: async () => {
    try {
      set({ authLoading: true })
      const user = await getAuthUser()
      // Construct a default username from user id when backend doesn't return one
      if (!user.name) {
        user.name = `User_${user.id.slice(0, 6)}`
      }
      // Use default avatar when backend doesn't return one
      if (!user.avatar) {
        user.avatar = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(user.name)}`
      }
      set({ user, isLoggedIn: true, authLoading: false })
    } catch {
      set({ user: null, isLoggedIn: false, authLoading: false })
    }
  },

  login: async () => {
    try {
      set({ authLoading: true })

      // Helper: poll /auth/status until logged in
      const startPolling = () => {
        const pollInterval = setInterval(async () => {
          try {
            const { loggedIn } = await getAuthStatus()
            if (loggedIn) {
              clearInterval(pollInterval)
              await get().fetchUser()
              await get().fetchCreditBalance()
              set({ authLoading: false })
            }
          } catch {
            // Continue polling
          }
        }, 2000)
        // 120 second timeout
        setTimeout(() => {
          clearInterval(pollInterval)
          set({ authLoading: false })
        }, 120000)
        return pollInterval
      }

      if (isTauri) {
        // Use HTTP callback + polling for reliable token delivery.
        // Deep link is only used to bring the app window to foreground (triggered by the callback page).
        const { loginUrl } = await getAuthLoginUrl()
        const { openUrl } = await import('@tauri-apps/plugin-opener')
        await openUrl(loginUrl)
        startPolling()
      } else {
        // Web mode: polling
        const { loginUrl } = await getAuthLoginUrl()
        window.open(loginUrl, '_blank')
        startPolling()
      }
    } catch (err) {
      console.error('Login failed:', err)
      set({ authLoading: false })
    }
  },

  logout: async () => {
    try {
      await authLogout()
    } catch {
      // Always clear local UI state even if backend request fails
    }
    set({ user: null, isLoggedIn: false, creditBalance: null })
  },

  updateProfile: async (params) => {
    const updatedUser = await apiUpdateProfile(params)
    set({ user: updatedUser })
  },

  // Credits
  creditBalance: null,

  fetchCreditBalance: async () => {
    try {
      const { balance } = await getCreditBalance()
      set({ creditBalance: balance })
    } catch {
      set({ creditBalance: null })
    }
  },

  openPayPage: async () => {
    try {
      const { payUrl } = await getPayUrl()
      if (isTauri) {
        const { openUrl } = await import('@tauri-apps/plugin-opener')
        await openUrl(payUrl)
      } else {
        window.open(payUrl, '_blank')
      }

      // Poll for balance change
      const oldBalance = get().creditBalance
      const pollInterval = setInterval(async () => {
        try {
          const { balance } = await getCreditBalance()
          if (balance !== oldBalance) {
            clearInterval(pollInterval)
            set({ creditBalance: balance })
          }
        } catch {
          // Continue polling
        }
      }, 3000)

      setTimeout(() => clearInterval(pollInterval), 120000)
    } catch (err) {
      console.error('Open pay page failed:', err)
    }
  },

  hydrate: async () => {
    const [theme, locale, sidebar] = await Promise.all([
      getItem("theme"),
      getItem("locale"),
      getItem("sidebar-collapsed"),
    ])
    const resolvedTheme = (theme as Theme) ?? "system"
    set({
      theme: resolvedTheme,
      locale: (locale as Locale) ?? (navigator.language.startsWith("zh") ? "zh" : "en"),
      sidebarCollapsed: sidebar === "true",
    })
    applyThemeToDOM(resolvedTheme)

    // Check git availability on Windows
    const isWindows = navigator.userAgent.includes('Windows')
    if (isWindows) {
      await get().recheckGit()
    }

    // Check cloud service status & model configuration
    try {
      const { enabled } = await getCloudStatus()
      set({ cloudEnabled: enabled })
      if (enabled) {
        const { loggedIn } = await getAuthStatus()
        if (loggedIn) {
          await get().fetchUser()
          await get().fetchCreditBalance()
        }
      }

      // Fetch model settings to determine availability
      const settings = await getSettings()
      const { provider } = settings.activeModel

      if (!enabled && (provider === 'builtin' || provider === 'cloud')) {
        // Builtin/cloud models unavailable in offline mode, auto-switch to custom
        await updateSettings({ activeModel: { provider: 'custom' } })
        // Only considered ready when custom models exist
        set({ modelReady: settings.customModels.length > 0 })
      } else if (provider === 'custom') {
        const model = settings.activeModel.id
          ? settings.customModels.find((m) => m.id === settings.activeModel.id)
          : settings.customModels[0]
        set({ modelReady: !!model })
      } else {
        // Builtin/cloud models available in online mode
        set({ modelReady: true })
      }
    } catch {
      // Backend not ready, ignore
    }
  },
}))
