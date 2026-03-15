import { test, expect } from '../../fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

export { test, expect }

// ===== 常量 =====

export const API_BASE = 'http://localhost:23107'
export const UNIQUE = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

// ===== API 辅助函数 =====

/** 通过 API 创建浏览器 Profile，返回 { id, name, created_at } */
export async function createProfileViaAPI(
  request: APIRequestContext,
  name?: string,
) {
  const profileName = name ?? UNIQUE()
  const res = await request.post(`${API_BASE}/api/browser-profiles`, {
    data: { name: profileName },
  })
  expect(res.status()).toBe(201)
  return (await res.json()) as { id: string; name: string; created_at: string }
}

/** 获取所有浏览器 Profile */
export async function getProfilesViaAPI(request: APIRequestContext) {
  const res = await request.get(`${API_BASE}/api/browser-profiles`)
  return (await res.json()) as Array<{ id: string; name: string; created_at: string }>
}

/** 通过 API 删除浏览器 Profile */
export async function deleteProfileViaAPI(request: APIRequestContext, id: string) {
  await request.delete(`${API_BASE}/api/browser-profiles/${encodeURIComponent(id)}`)
}

/** 清理所有 E2E 前缀的 Profile */
export async function cleanupE2EProfiles(request: APIRequestContext) {
  try {
    const profiles = await getProfilesViaAPI(request)
    for (const p of profiles) {
      if (p.name.startsWith('E2E')) {
        await deleteProfileViaAPI(request, p.id).catch(() => {})
      }
    }
  } catch {
    // 服务不可用时跳过清理
  }
}

// ===== UI 辅助函数 =====

/** 导航到浏览器 Profile 页：打开 Settings → 点击 Browser Tab */
export async function navigateToBrowser(page: Page) {
  await page.getByRole('button', { name: /settings/i }).click()
  await page.getByRole('button', { name: /browser/i }).click()
  await page.waitForTimeout(500)
}

/** 通过 API 启动浏览器 Profile（不断言状态码） */
export async function launchProfileViaAPI(request: APIRequestContext, id: string) {
  return request.post(`${API_BASE}/api/browser-profiles/${encodeURIComponent(id)}/launch`)
}

/** 通过 UI 创建 Profile */
export async function createProfileUI(page: Page, name: string) {
  await page.getByTestId('browser-create-btn').click()
  await page.getByTestId('browser-input-name').fill(name)

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/browser-profiles') && r.request().method() === 'POST' && r.status() === 201,
  )
  await page.getByTestId('browser-submit-btn').click()
  await responsePromise
}
