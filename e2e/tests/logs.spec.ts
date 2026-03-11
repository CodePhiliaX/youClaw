import { test, expect } from '../fixtures'

test.describe('日志查看', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByTestId('nav-logs').click()
    await page.waitForLoadState('networkidle')
  })

  test('日志页面加载', async ({ page }) => {
    // 日期选择器可见
    await expect(page.getByTestId('logs-select-date')).toBeVisible({ timeout: 10_000 })
  })

  test('过滤功能', async ({ page }) => {
    // 等待页面完全加载
    await page.waitForTimeout(2000)

    // 搜索框可见
    const searchInput = page.getByTestId('logs-search')
    await expect(searchInput).toBeVisible()

    // 输入搜索关键词
    await searchInput.fill('test')
    await page.waitForTimeout(1000) // 等待防抖

    // 级别下拉框可见
    await expect(page.getByTestId('logs-select-level')).toBeVisible()

    // 尝试点击类别按钮
    const allBtn = page.getByTestId('logs-category-all')
    if (await allBtn.isVisible()) {
      await allBtn.click()
    }
  })

  test('加载更多', async ({ page }) => {
    await page.waitForTimeout(2000)

    // 如果有加载更多按钮，点击它
    const loadMoreBtn = page.getByTestId('logs-load-more')
    if (await loadMoreBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await loadMoreBtn.click()
      await page.waitForTimeout(1000)
    }
  })
})
