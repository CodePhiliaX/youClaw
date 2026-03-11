// Transport 抽象层：自动检测 Electron / Web 环境

export interface ElectronAPI {
  // 通用 API 调用（替代 HTTP fetch）
  apiFetch: (method: string, path: string, body?: string) => Promise<{ status: number; data: unknown }>

  // 事件订阅（替代 SSE）
  subscribeEvents: (chatId: string) => Promise<{ subId: string }>
  unsubscribeEvents: (subId: string) => Promise<void>
  onAgentEvent: (callback: (event: unknown) => void) => () => void

  // App
  getVersion: () => Promise<string>
  getPlatform: () => string

  // Theme
  getTheme: () => Promise<string>
  setTheme: (theme: string) => Promise<void>

  // Updates
  checkForUpdates: () => Promise<string | null>
  installUpdate: () => Promise<void>
  getAllowPrerelease: () => Promise<boolean>
  setAllowPrerelease: (value: boolean) => Promise<void>

  // 事件
  onUpdateStatus: (callback: (status: string, data?: unknown) => void) => () => void
  onOpenSettings: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export const isElectron = typeof window !== "undefined" && !!window.electronAPI

export function getElectronAPI(): ElectronAPI {
  if (!window.electronAPI) {
    throw new Error("electronAPI not available")
  }
  return window.electronAPI
}
