import { test, expect, createChannelViaAPI, cleanupE2EChannels, navigateToChannels } from './helpers'

test.describe('Level 1: Channels 页面加载与基本 UI', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToChannels(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2EChannels(request)
  })

  test('导航到 Channels 页面成功', async ({ page }) => {
    expect(page.url()).toContain('/channels')
  })

  test('添加按钮可见', async ({ page }) => {
    await expect(page.getByTestId('channel-create-btn')).toBeVisible()
  })

  test('刷新按钮可见', async ({ page }) => {
    await expect(page.getByTestId('channel-refresh-btn')).toBeVisible()
  })

  test('无 channel 时显示空提示', async ({ request, page }) => {
    await cleanupE2EChannels(request)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // 如果所有 channel 都已清理，应显示空提示
    const channels = await page.getByTestId('channel-item').all()
    if (channels.length === 0) {
      await expect(page.getByTestId('channel-empty')).toBeVisible()
    }
  })

  test('有 channel 时列表项可见', async ({ request, page }) => {
    await createChannelViaAPI(request)
    await page.reload()
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('channel-item').first()).toBeVisible()
  })
})
