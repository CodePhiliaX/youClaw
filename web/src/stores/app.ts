import { create } from 'zustand'
import { getItem, removeItem, setItem } from '@/lib/storage'
import { applyThemeToDOM, type Theme } from '@/hooks/useTheme'
import { getAuthUser, getAuthStatus, getAuthLoginUrl, authLogout, getCreditBalance, getPayUrl, updateProfile as apiUpdateProfile, getCloudStatus, getSettings, updateSettings, checkGit, type AuthUser } from '@/api/client'
import { isTauri, openExternal } from '@/api/transport'
import type { Locale } from '@/i18n/context'

export type CloseAction = '' | 'minimize' | 'quit'

let authPollInterval: ReturnType<typeof setInterval> | null = null
let authPollTimeout: ReturnType<typeof setTimeout> | null = null

function clearAuthPolling() {
  if (authPollInterval) {
    clearInterval(authPollInterval)
    authPollInterval = null
  }
  if (authPollTimeout) {
    clearTimeout(authPollTimeout)
    authPollTimeout = null
  }
}

async function ensureWindowsDeepLinkRegistration(): Promise<void> {
  if (!isTauri || !navigator.userAgent.includes('Windows')) return

  try {
    const { isRegistered, register } = await import('@tauri-apps/plugin-deep-link')
    const registered = await isRegistered('youclaw')
    if (!registered) {
      await register('youclaw')
    }
  } catch (err) {
    console.error('Failed to verify/register deep-link protocol:', err)
  }
}

interface AppState {
  theme: Theme
  setTheme: (theme: Theme) => void

  locale: Locale
  setLocale: (locale: Locale) => void

  closeAction: CloseAction
  setCloseAction: (closeAction: CloseAction) => Promise<void>

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
  theme: 'system',
  setTheme: (theme) => {
    set({ theme })
    applyThemeToDOM(theme)
    void setItem('theme', theme)
  },

  locale: 'en',
  setLocale: (locale) => {
    set({ locale })
    void setItem('locale', locale)
  },

  closeAction: '',
  setCloseAction: async (closeAction) => {
    set({ closeAction })
    if (closeAction) {
      await setItem('close_action', closeAction)
      return
    }
    await removeItem('close_action')
  },

  sidebarCollapsed: false,
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    set({ sidebarCollapsed: next })
    void setItem('sidebar-collapsed', String(next))
  },
  collapseSidebar: () => {
    set({ sidebarCollapsed: true })
    void setItem('sidebar-collapsed', 'true')
  },
  expandSidebar: () => {
    set({ sidebarCollapsed: false })
    void setItem('sidebar-collapsed', 'false')
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
        clearAuthPolling()
        authPollInterval = setInterval(async () => {
          try {
            const { loggedIn } = await getAuthStatus()
            if (loggedIn) {
              clearAuthPolling()
              await get().fetchUser()
              await get().fetchCreditBalance()
              set({ authLoading: false })
            }
          } catch {
            // Continue polling
          }
        }, 2000)
        // 120 second timeout
        authPollTimeout = setTimeout(() => {
          clearAuthPolling()
          set({ authLoading: false })
        }, 120000)
      }

      if (isTauri) {
        await ensureWindowsDeepLinkRegistration()
        // New desktop builds opt into the Tauri deep-link callback explicitly.
        // Older clients keep calling /api/auth/login without platform=tauri and continue
        // using the legacy localhost callback flow, so we preserve backwards compatibility.
        const { loginUrl } = await getAuthLoginUrl('tauri')
        await openExternal(loginUrl)
        startPolling()
      } else {
        // Web mode: polling
        const { loginUrl } = await getAuthLoginUrl()
        await openExternal(loginUrl)
        startPolling()
      }
    } catch (err) {
      console.error('Login failed:', err)
      set({ authLoading: false })
    }
  },

  logout: async () => {
    clearAuthPolling()
    try {
      await authLogout()
    } catch {
      // Always clear local UI state even if backend request fails
    }
    set({ user: null, isLoggedIn: false, authLoading: false, creditBalance: null })
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
      if (isTauri) {
        const { payUrl } = await getPayUrl('tauri')
        await openExternal(payUrl)
      } else {
        const { payUrl } = await getPayUrl()
        await openExternal(payUrl)
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
    const [theme, locale, closeAction, sidebar] = await Promise.all([
      getItem('theme'),
      getItem('locale'),
      getItem('close_action'),
      getItem('sidebar-collapsed'),
    ])
    const resolvedTheme = (theme as Theme) ?? 'system'
    set({
      theme: resolvedTheme,
      locale: (locale as Locale) ?? (navigator.language.startsWith('zh') ? 'zh' : 'en'),
      closeAction: closeAction === 'minimize' || closeAction === 'quit' ? closeAction : '',
      sidebarCollapsed: sidebar === 'true',
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
