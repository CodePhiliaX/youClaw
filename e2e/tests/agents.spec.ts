import { test, expect } from '../fixtures'

test.describe('Agent 管理', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByTestId('nav-agents').click()
    await page.waitForLoadState('networkidle')
  })

  test('显示 Agent 列表', async ({ page }) => {
    // 至少有一个 agent（default）
    await expect(page.getByTestId('agent-item').first()).toBeVisible({ timeout: 10_000 })
  })

  test('查看 Agent 详情并展开文档', async ({ page }) => {
    // 点击第一个 agent
    await page.getByTestId('agent-item').first().click()
    await page.waitForLoadState('networkidle')

    // 等待文档区出现（折叠的文档标题按钮）
    const soulBtn = page.getByRole('button', { name: /Soul.*SOUL\.md/i })
    await expect(soulBtn).toBeVisible({ timeout: 10_000 })

    // 展开 SOUL.md 文档
    await soulBtn.click()

    // 编辑按钮现在应该可见
    await expect(page.getByTestId('doc-edit-btn').first()).toBeVisible({ timeout: 5_000 })
  })

  test('编辑 Agent 文档', async ({ page }) => {
    // 点击第一个 agent
    await page.getByTestId('agent-item').first().click()
    await page.waitForLoadState('networkidle')

    // 展开 SOUL.md
    const soulBtn = page.getByRole('button', { name: /Soul.*SOUL\.md/i })
    await expect(soulBtn).toBeVisible({ timeout: 10_000 })
    await soulBtn.click()

    // 点击编辑按钮
    await page.getByTestId('doc-edit-btn').first().click()

    // textarea 应出现
    await expect(page.getByTestId('doc-textarea').first()).toBeVisible()

    // 获取当前内容
    const textarea = page.getByTestId('doc-textarea').first()
    const originalContent = await textarea.inputValue()

    // 添加一行测试内容
    const testLine = `\n<!-- e2e test ${Date.now()} -->`
    await textarea.fill(originalContent + testLine)

    // 保存
    await page.getByTestId('doc-save-btn').first().click()

    // 等待保存完成
    await page.waitForTimeout(1000)

    // 重新编辑验证内容持久化
    await page.getByTestId('doc-edit-btn').first().click()
    const savedContent = await page.getByTestId('doc-textarea').first().inputValue()
    expect(savedContent).toContain('e2e test')

    // 恢复原始内容
    await page.getByTestId('doc-textarea').first().fill(originalContent)
    await page.getByTestId('doc-save-btn').first().click()
  })
})
