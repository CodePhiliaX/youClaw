// Transport 抽象层：自动检测 Tauri / Web 环境

export const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__

export function getTauriInvoke(): (cmd: string, args?: Record<string, unknown>) => Promise<unknown> {
  if (!isTauri) throw new Error("Not in Tauri environment")
  return (window as any).__TAURI_INTERNALS__.invoke
}

// 缓存后端 baseUrl，避免重复读 store
let _cachedBaseUrl: string | null = null

/**
 * 获取后端 baseUrl
 * - Tauri 模式：从 store 读 port，默认 3000
 * - Web 模式：空字符串（走 Vite proxy）
 */
export async function getBackendBaseUrl(): Promise<string> {
  if (!isTauri) return ''
  if (_cachedBaseUrl !== null) return _cachedBaseUrl

  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load('settings.json')
    const port = (await store.get<string>('port')) || '3000'
    _cachedBaseUrl = `http://localhost:${port}`
  } catch {
    _cachedBaseUrl = 'http://localhost:3000'
  }
  return _cachedBaseUrl
}

/**
 * 同步获取 baseUrl（用于 EventSource 等不支持 async 的场景）
 * 必须先调用 initBaseUrl() 初始化
 */
export function getBaseUrlSync(): string {
  if (!isTauri) return ''
  return _cachedBaseUrl ?? 'http://localhost:3000'
}

/** 应用启动时调用一次，预加载 baseUrl。优先从 store 快速读取，同时监听 sidecar ready 事件更新端口 */
export async function initBaseUrl(): Promise<void> {
  if (!isTauri) return

  // 先从 store 快速读取端口，不阻塞渲染
  await getBackendBaseUrl()

  // 同时监听 sidecar-event，如果 sidecar 重启或端口变更则更新缓存
  try {
    const { listen } = await import('@tauri-apps/api/event')
    listen<{ status: string; message: string }>('sidecar-event', (event) => {
      if (event.payload.status === 'ready') {
        const match = event.payload.message.match(/port\s+(\d+)/)
        if (match) {
          _cachedBaseUrl = `http://localhost:${match[1]}`
        }
      }
    })
  } catch {
    // 监听失败不影响启动
  }
}
