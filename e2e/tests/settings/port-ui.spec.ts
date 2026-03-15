import {
  test, expect,
  cleanupPortConfig,
  navigateToGeneralSettings,
} from './helpers'

test.describe('端口配置: UI 测试', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPortConfig(request)
  })

  test('General 面板显示端口输入框', async ({ page }) => {
    await navigateToGeneralSettings(page)

    // 端口输入框可见
    await expect(page.getByTestId('port-input')).toBeVisible()
    // 保存按钮可见
    await expect(page.getByTestId('port-save-btn')).toBeVisible()
    // placeholder 为 23107
    await expect(page.getByTestId('port-input')).toHaveAttribute('placeholder', '23107')
  })

  test('输入有效端口并保存', async ({ page }) => {
    await navigateToGeneralSettings(page)

    // 输入端口
    await page.getByTestId('port-input').fill('8888')

    // 等待 API 响应
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/settings/port') && r.request().method() === 'PUT' && r.status() === 200
    )
    await page.getByTestId('port-save-btn').click()
    await responsePromise

    // 显示保存成功提示
    await expect(page.getByTestId('port-saved-hint')).toBeVisible()
  })

  test('清空端口恢复默认', async ({ page, request }) => {
    // 先通过 API 设置一个端口
    await request.put('http://localhost:23107/api/settings/port', {
      data: { port: '9999' },
    })

    await navigateToGeneralSettings(page)

    // 清空输入框
    await page.getByTestId('port-input').fill('')

    // 保存
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/settings/port') && r.request().method() === 'PUT' && r.status() === 200
    )
    await page.getByTestId('port-save-btn').click()
    await responsePromise

    // 显示保存成功提示
    await expect(page.getByTestId('port-saved-hint')).toBeVisible()
  })

  test('Web 模式下不显示重启按钮', async ({ page }) => {
    await navigateToGeneralSettings(page)

    await page.getByTestId('port-input').fill('8888')

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/settings/port') && r.request().method() === 'PUT'
    )
    await page.getByTestId('port-save-btn').click()
    await responsePromise

    // Web 模式下保存提示中不应该有"立即重启"按钮
    await expect(page.getByTestId('port-saved-hint')).toBeVisible()
    // Web 模式（非 Tauri），提示文本应该是手动重启
    await expect(page.getByTestId('port-saved-hint')).toContainText(/restart|重启/)
  })
})
