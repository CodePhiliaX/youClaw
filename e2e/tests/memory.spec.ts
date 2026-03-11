import { test, expect } from '../fixtures'

test.describe('Memory 管理', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByTestId('nav-memory').click()
    await page.waitForLoadState('networkidle')
  })

  test('Memory 页面加载', async ({ page }) => {
    // Agent 选择器可见
    await expect(page.getByTestId('memory-select-agent')).toBeVisible({ timeout: 10_000 })
  })

  test('查看和编辑 MEMORY.md', async ({ page }) => {
    // 等待编辑按钮出现
    const editBtn = page.getByTestId('memory-edit-btn')
    await expect(editBtn).toBeVisible({ timeout: 10_000 })

    // 点击编辑
    await editBtn.click()

    // textarea 应出现
    const textarea = page.getByTestId('memory-textarea')
    await expect(textarea).toBeVisible()

    // 获取当前内容
    const originalContent = await textarea.inputValue()

    // 添加测试内容
    const testLine = `\n<!-- e2e memory test ${Date.now()} -->`
    await textarea.fill(originalContent + testLine)

    // 保存
    await page.getByTestId('memory-save-btn').click()
    await page.waitForTimeout(1000)

    // 重新编辑验证持久化
    await editBtn.click()
    const savedContent = await page.getByTestId('memory-textarea').inputValue()
    expect(savedContent).toContain('e2e memory test')

    // 恢复原始内容
    await page.getByTestId('memory-textarea').fill(originalContent)
    await page.getByTestId('memory-save-btn').click()
  })

  test('切换 Tab', async ({ page }) => {
    // 切换到 Logs tab
    const logsTab = page.getByTestId('memory-tab-logs')
    if (await logsTab.isVisible()) {
      await logsTab.click()
    }

    // 切换到 Archives tab
    const archivesTab = page.getByTestId('memory-tab-archives')
    if (await archivesTab.isVisible()) {
      await archivesTab.click()
    }

    // 切换到 Search tab
    const searchTab = page.getByTestId('memory-tab-search')
    if (await searchTab.isVisible()) {
      await searchTab.click()
    }
  })
})
