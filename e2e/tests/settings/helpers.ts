import { test, expect } from '../../fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

export { test, expect }

// ===== 常量 =====

export const API_BASE = 'http://localhost:23107'

// ===== API 辅助函数 =====

/** 获取端口配置 */
export async function getPortViaAPI(request: APIRequestContext): Promise<string | null> {
  const res = await request.get(`${API_BASE}/api/settings/port`)
  const data = await res.json()
  return data.port
}

/** 设置端口配置 */
export async function setPortViaAPI(request: APIRequestContext, port: string | null) {
  const res = await request.put(`${API_BASE}/api/settings/port`, {
    data: { port },
  })
  expect(res.status()).toBe(200)
  return res.json()
}

/** 清理端口配置（恢复默认） */
export async function cleanupPortConfig(request: APIRequestContext) {
  await request.put(`${API_BASE}/api/settings/port`, {
    data: { port: null },
  })
}

// ===== UI 辅助函数 =====

/** 打开设置弹窗并切换到 General tab */
export async function navigateToGeneralSettings(page: Page) {
  // 点击侧边栏底部用户区触发器打开 DropdownMenu
  const triggerButton = page.locator('button').filter({ hasText: /Offline Mode|离线模式|Pro Plan/i })
  await triggerButton.click()

  // 在弹出的菜单中点击 "Settings" / "设置"
  await page.getByRole('menuitem', { name: /settings|设置/i }).click()

  // 在设置弹窗中切换到 General tab
  await page.getByRole('button', { name: /general|通用/i }).click()
  await page.waitForTimeout(300)
}
