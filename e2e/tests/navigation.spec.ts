import { test, expect } from '../fixtures'

test.describe('导航冒烟测试', () => {
  test('页面加载成功', async ({ page }) => {
    // page 已经在 '/' 了
    await expect(page).toHaveTitle(/.+/)
    await expect(page.getByTestId('nav-chat')).toBeVisible()
  })

  test('侧边栏导航可用', async ({ page }) => {
    const routes = [
      { testId: 'nav-agents', url: '/agents' },
      { testId: 'nav-cron', url: '/cron' },
      { testId: 'nav-memory', url: '/memory' },
      { testId: 'nav-skills', url: '/skills' },
      { testId: 'nav-logs', url: '/logs' },
      { testId: 'nav-system', url: '/system' },
      { testId: 'nav-chat', url: '/' },
    ]
    for (const { testId, url } of routes) {
      await page.getByTestId(testId).click()
      await expect(page).toHaveURL(new RegExp(url === '/' ? '/$' : url))
    }
  })
})
