import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use) => {
    // 首页会触发持续中的后台请求，使用“可交互”而不是 networkidle 作为就绪条件。
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('nav-chat')).toBeVisible({ timeout: 30_000 })
    await use(page)
  },
})

export { expect } from '@playwright/test'
