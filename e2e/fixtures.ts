import { test as base } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use) => {
    // 等待页面完全加载
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await use(page)
  },
})

export { expect } from '@playwright/test'
