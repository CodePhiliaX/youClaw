import { test, expect, cleanupE2EProfiles, createProfileViaAPI, navigateToBrowser } from './helpers'

test.describe('Browser Profiles: 页面加载与基本 UI', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBrowser(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2EProfiles(request)
  })

  test('核心元素可见', async ({ page }) => {
    await expect(page.getByTestId('browser-create-btn')).toBeVisible()
    expect(page.url()).toContain('/browser')
  })

  test('无 Profile 时显示空状态', async ({ page, request }) => {
    // 清理所有 profiles（包括非 E2E 的）确保空状态
    const profiles = await (await request.get('http://localhost:23107/api/browser-profiles')).json() as Array<{ id: string }>
    for (const p of profiles) {
      await request.delete(`http://localhost:23107/api/browser-profiles/${p.id}`).catch(() => {})
    }
    await page.reload()
    await page.waitForLoadState('networkidle')

    // 空状态文本（中文或英文）
    const emptyText = page.locator('text=No browser profiles yet')
    const emptyTextCn = page.locator('text=暂无浏览器 Profile')
    await expect(emptyText.or(emptyTextCn)).toBeVisible({ timeout: 5_000 })
  })

  test('创建按钮打开表单', async ({ page }) => {
    await page.getByTestId('browser-create-btn').click()
    await expect(page.getByTestId('browser-input-name')).toBeVisible()
    await expect(page.getByTestId('browser-submit-btn')).toBeVisible()
    await expect(page.getByTestId('browser-cancel-btn')).toBeVisible()
  })

  test('取消按钮关闭表单', async ({ page }) => {
    await page.getByTestId('browser-create-btn').click()
    await expect(page.getByTestId('browser-input-name')).toBeVisible()
    await page.getByTestId('browser-cancel-btn').click()
    await expect(page.getByTestId('browser-input-name')).not.toBeVisible()
  })

  test('提交按钮在名称为空时禁用', async ({ page }) => {
    await page.getByTestId('browser-create-btn').click()
    await expect(page.getByTestId('browser-submit-btn')).toBeDisabled()

    // 纯空格仍禁用
    await page.getByTestId('browser-input-name').fill('   ')
    await expect(page.getByTestId('browser-submit-btn')).toBeDisabled()

    // 有内容则启用
    await page.getByTestId('browser-input-name').fill('Test')
    await expect(page.getByTestId('browser-submit-btn')).toBeEnabled()
  })

  test('列表数据与 API 一致', async ({ page, request }) => {
    const name1 = `E2E-ui-${Date.now()}-a`
    const name2 = `E2E-ui-${Date.now()}-b`
    await createProfileViaAPI(request, name1)
    await createProfileViaAPI(request, name2)

    await page.reload()
    await page.waitForLoadState('networkidle')

    const item1 = page.getByTestId('browser-profile-item').filter({ hasText: name1 })
    const item2 = page.getByTestId('browser-profile-item').filter({ hasText: name2 })

    await expect(item1).toBeVisible()
    await expect(item2).toBeVisible()
  })
})
