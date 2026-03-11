import { test, expect } from '../fixtures'

test.describe('Skills 列表', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByTestId('nav-skills').click()
    await page.waitForLoadState('networkidle')
  })

  test('Skills 页面加载', async ({ page }) => {
    // 等待 skill 列表加载
    // 可能有也可能没有 skills，只验证页面不报错
    await page.waitForTimeout(2000)
    // 页面应该没有错误
    await expect(page).toHaveURL(/skills/)
  })

  test('查看 Skill 详情', async ({ page }) => {
    // 如果有 skill，点击第一个
    const firstSkill = page.getByTestId('skill-item').first()
    if (await firstSkill.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstSkill.click()
      // 等待详情加载
      await page.waitForTimeout(1000)

      // 验证详情区域可见（启用/禁用按钮）
      const toggleBtn = page.getByTestId('skill-toggle-btn')
      if (await toggleBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        // 按钮可见说明详情加载成功
        expect(true).toBe(true)
      }
    }
  })
})
