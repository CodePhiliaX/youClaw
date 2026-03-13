import { test, expect } from '../../fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

export { test, expect }

// ===== 常量 =====

export const API_BASE = 'http://localhost:3000'
export const UNIQUE = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

// ===== API 辅助函数 =====

/** 通过 API 创建 channel */
export async function createChannelViaAPI(
  request: APIRequestContext,
  overrides: {
    id?: string
    type?: string
    label?: string
    config?: Record<string, unknown>
    enabled?: boolean
  } = {}
) {
  const body = {
    type: overrides.type ?? 'telegram',
    label: overrides.label ?? UNIQUE(),
    config: overrides.config ?? { botToken: `fake-${Date.now()}` },
    enabled: overrides.enabled ?? false,
    ...(overrides.id ? { id: overrides.id } : {}),
  }
  const res = await request.post(`${API_BASE}/api/channels`, { data: body })
  expect(res.status()).toBe(201)
  return await res.json()
}

/** 获取所有 channels */
export async function getChannelsViaAPI(request: APIRequestContext) {
  const res = await request.get(`${API_BASE}/api/channels`)
  return await res.json()
}

/** 获取 channel 类型列表 */
export async function getChannelTypesViaAPI(request: APIRequestContext) {
  const res = await request.get(`${API_BASE}/api/channels/types`)
  return await res.json()
}

/** 通过 API 更新 channel */
export async function updateChannelViaAPI(
  request: APIRequestContext,
  id: string,
  data: { label?: string; config?: Record<string, unknown>; enabled?: boolean }
) {
  const res = await request.put(`${API_BASE}/api/channels/${encodeURIComponent(id)}`, { data })
  return { status: res.status(), body: await res.json() }
}

/** 通过 API 删除 channel */
export async function deleteChannelViaAPI(request: APIRequestContext, id: string) {
  const res = await request.delete(`${API_BASE}/api/channels/${encodeURIComponent(id)}`)
  return { status: res.status(), body: await res.json() }
}

/** 清理所有 E2E 前缀的 channel */
export async function cleanupE2EChannels(request: APIRequestContext) {
  const channels = await getChannelsViaAPI(request)
  for (const ch of channels) {
    if (ch.label?.startsWith('E2E') || ch.id?.startsWith('e2e-')) {
      await request.delete(`${API_BASE}/api/channels/${encodeURIComponent(ch.id)}`)
    }
  }
}

// ===== UI 辅助函数 =====

/** 导航到 Channels 页并等待加载 */
export async function navigateToChannels(page: Page) {
  await page.getByTestId('nav-channels').click()
  await page.waitForLoadState('networkidle')
}
