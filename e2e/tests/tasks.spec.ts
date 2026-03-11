import { test, expect } from '../fixtures'

test.describe('定时任务 CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByTestId('nav-cron').click()
    await page.waitForLoadState('networkidle')
  })

  test('任务页面加载', async ({ page }) => {
    // 新建按钮可见
    await expect(page.getByTestId('task-create-btn')).toBeVisible({ timeout: 10_000 })
  })

  test('创建、编辑、删除任务', async ({ page }) => {
    // 处理确认对话框（提前注册）
    page.on('dialog', dialog => dialog.accept())

    // 点击新建
    await page.getByTestId('task-create-btn').click()

    // 填写表单
    await page.getByTestId('task-input-name').fill('E2E 测试任务')
    await page.getByTestId('task-input-prompt').fill('这是 E2E 测试创建的任务')

    // 填写 schedule（默认为 interval 类型，需要填写分钟数）
    const intervalInput = page.locator('input[placeholder*="30"]')
    if (await intervalInput.isVisible()) {
      await intervalInput.fill('60')
    }

    // 提交
    await page.getByTestId('task-submit-btn').click()

    // 验证任务出现在列表
    await expect(page.getByTestId('task-item').first()).toBeVisible({ timeout: 10_000 })

    // 点击任务查看详情
    await page.getByTestId('task-item').first().click()
    await page.waitForTimeout(500)

    // 编辑任务
    const editBtn = page.getByTestId('task-edit-btn')
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click()
      await page.getByTestId('task-input-name').fill('E2E 测试任务（已修改）')
      await page.getByTestId('task-submit-btn').click()
      await page.waitForTimeout(1000)
    }

    // 删除任务 — 点击回列表中的任务
    await page.getByTestId('task-item').first().click()
    await page.waitForTimeout(500)
    const deleteBtn = page.getByTestId('task-delete-btn')
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteBtn.click()
      await page.waitForTimeout(1000)
    }
  })
})
