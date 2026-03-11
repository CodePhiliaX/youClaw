import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // ===== 通用 API 调用（替代 HTTP fetch） =====
  apiFetch: (method: string, path: string, body?: string) =>
    ipcRenderer.invoke("api-fetch", { method, path, body }),

  // ===== 事件订阅（替代 SSE） =====
  subscribeEvents: (chatId: string) => ipcRenderer.invoke("subscribe-events", chatId),
  unsubscribeEvents: (subId: string) => ipcRenderer.invoke("unsubscribe-events", subId),
  onAgentEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("agent-event", handler);
    return () => ipcRenderer.removeListener("agent-event", handler);
  },

  // ===== App 信息 =====
  getVersion: () => ipcRenderer.invoke("get-version"),
  getPlatform: () => process.platform,

  // ===== Theme =====
  getTheme: () => ipcRenderer.invoke("get-theme"),
  setTheme: (theme: string) => ipcRenderer.invoke("set-theme", theme),

  // ===== Updates =====
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  getAllowPrerelease: () => ipcRenderer.invoke("get-allow-prerelease"),
  setAllowPrerelease: (value: boolean) => ipcRenderer.invoke("set-allow-prerelease", value),

  // ===== 事件监听 =====
  onUpdateStatus: (callback: (status: string, data?: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: string, data?: unknown) =>
      callback(status, data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },
  onOpenSettings: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("open-settings", handler);
    return () => ipcRenderer.removeListener("open-settings", handler);
  },
});
