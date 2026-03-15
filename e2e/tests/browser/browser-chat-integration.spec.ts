import { test, expect, UNIQUE, createProfileViaAPI, getProfilesViaAPI, deleteProfileViaAPI, cleanupE2EProfiles } from './helpers'

const API_BASE = 'http://localhost:23107'

test.describe('Browser Profiles: Chat 集成', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EProfiles(request)
  })

  /** 创建 profile 后导航到 Chat 页并 reload 确保 ChatProvider 加载到新 profile */
  async function navigateToChatWithProfile(page: import('@playwright/test').Page) {
    await page.getByTestId('nav-chat').click()
    await page.reload()
    await page.waitForLoadState('networkidle')
  }

  test('Chat 页面无 Profile 时不显示 Globe 选择器', async ({ page, request }) => {
    // 先清理所有 profiles 确保环境干净
    const profiles = await getProfilesViaAPI(request)
    for (const p of profiles) {
      await deleteProfileViaAPI(request, p.id)
    }

    await page.getByTestId('nav-chat').click()
    await page.reload()
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('chat-browser-profile-trigger')).not.toBeVisible()
  })

  test('Chat 页面有 Profile 时显示 Globe 选择器', async ({ page, request }) => {
    await createProfileViaAPI(request, `E2E-chat-globe-${Date.now()}`)
    await navigateToChatWithProfile(page)

    await expect(page.getByTestId('chat-browser-profile-trigger')).toBeVisible({ timeout: 5_000 })
  })

  test('Globe 选择器列出可用 Profile', async ({ page, request }) => {
    const name = `E2E-chat-list-${Date.now()}`
    await createProfileViaAPI(request, name)
    await navigateToChatWithProfile(page)

    // 点击 Globe 按钮打开下拉
    await page.getByTestId('chat-browser-profile-trigger').click()

    // 下拉中应有 Profile 名称和 "不使用" 选项
    await expect(page.getByRole('option').filter({ hasText: name })).toBeVisible()
    await expect(page.getByTestId('chat-browser-profile-none')).toBeVisible()
  })

  test('选择 Profile 后显示名称', async ({ page, request }) => {
    const name = `E2E-chat-select-${Date.now()}`
    await createProfileViaAPI(request, name)
    await navigateToChatWithProfile(page)

    await page.getByTestId('chat-browser-profile-trigger').click()
    await page.getByRole('option').filter({ hasText: name }).click()

    await expect(page.getByTestId('chat-browser-profile-trigger')).toContainText(name)
  })

  test('选择"不使用"后恢复默认', async ({ page, request }) => {
    const name = `E2E-chat-deselect-${Date.now()}`
    await createProfileViaAPI(request, name)
    await navigateToChatWithProfile(page)

    // 先选中
    await page.getByTestId('chat-browser-profile-trigger').click()
    await page.getByRole('option').filter({ hasText: name }).click()
    await expect(page.getByTestId('chat-browser-profile-trigger')).toContainText(name)

    // 再取消
    await page.getByTestId('chat-browser-profile-trigger').click()
    await page.getByTestId('chat-browser-profile-none').click()

    // 按钮不再显示 Profile 名称
    await expect(page.getByTestId('chat-browser-profile-trigger')).not.toContainText(name)
  })

  test('发送消息时透传 browserProfileId', async ({ page, request }) => {
    const profile = await createProfileViaAPI(request, `E2E-chat-send-${Date.now()}`)
    await navigateToChatWithProfile(page)

    // 选择 Profile
    await page.getByTestId('chat-browser-profile-trigger').click()
    await page.getByRole('option').filter({ hasText: profile.name }).click()

    // 拦截 API 请求验证 body
    const requestPromise = page.waitForRequest(
      (r) => r.url().includes('/api/agents/') && r.url().includes('/message') && r.method() === 'POST',
    )

    await page.getByTestId('chat-input').fill('Browser profile test')
    await page.getByTestId('chat-send').click()

    const req = await requestPromise
    const body = req.postDataJSON()
    expect(body.browserProfileId).toBe(profile.id)
  })

  test('不选 Profile 时不发送 browserProfileId', async ({ page, request }) => {
    await createProfileViaAPI(request, `E2E-chat-nosend-${Date.now()}`)
    await navigateToChatWithProfile(page)

    const requestPromise = page.waitForRequest(
      (r) => r.url().includes('/api/agents/') && r.url().includes('/message') && r.method() === 'POST',
    )

    await page.getByTestId('chat-input').fill('No profile test')
    await page.getByTestId('chat-send').click()

    const req = await requestPromise
    const body = req.postDataJSON()
    expect(body.browserProfileId).toBeFalsy()
  })
})
