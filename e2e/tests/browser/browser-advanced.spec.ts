import {
  test, expect, UNIQUE, API_BASE,
  createProfileViaAPI, getProfilesViaAPI, deleteProfileViaAPI,
  cleanupE2EProfiles, navigateToBrowser, createProfileUI,
  launchProfileViaAPI,
} from './helpers'

test.describe('Browser Profiles: 高级功能', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EProfiles(request)
  })

  test.describe('Launch API 端点', () => {
    test('POST launch 存在的 Profile 返回 200', async ({ request }) => {
      const profile = await createProfileViaAPI(request)

      const res = await launchProfileViaAPI(request, profile.id)
      expect(res.status()).toBe(200)

      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.profileDir).toBeTruthy()
    })

    test('POST launch 不存在返回 404', async ({ request }) => {
      const res = await launchProfileViaAPI(request, 'fake-nonexistent-id')
      expect(res.status()).toBe(404)
    })
  })

  test.describe('请求体断言', () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBrowser(page)
    })

    test('创建 POST 发送 trim 后的名称', async ({ page }) => {
      await page.getByTestId('browser-create-btn').click()
      await page.getByTestId('browser-input-name').fill('  E2E-trimadvanced  ')

      const requestPromise = page.waitForRequest(
        (req) => req.url().includes('/api/browser-profiles') && req.method() === 'POST'
      )

      await page.getByTestId('browser-submit-btn').click()

      const req = await requestPromise
      const body = req.postDataJSON()
      expect(body.name).toBe('E2E-trimadvanced')
    })

    test('删除发送正确的 Profile ID URL', async ({ page, request }) => {
      const profile = await createProfileViaAPI(request)

      await page.reload()
      await page.waitForLoadState('networkidle')

      // 选中 Profile
      await page.getByTestId('browser-profile-item').filter({ hasText: profile.name }).click()

      // 注册 dialog accept
      page.once('dialog', (d) => d.accept())

      // 拦截 DELETE 请求
      const requestPromise = page.waitForRequest(
        (req) => req.url().includes('/api/browser-profiles/') && req.method() === 'DELETE'
      )

      await page.getByTestId('browser-delete-btn').click()

      const req = await requestPromise
      expect(req.url()).toContain(`/api/browser-profiles/${profile.id}`)
    })
  })

  test.describe('数据完整性', () => {
    test('Profile ID 格式为 8 位 hex', async ({ request }) => {
      const profile = await createProfileViaAPI(request)
      expect(profile.id).toMatch(/^[a-f0-9]{8}$/)
    })

    test('created_at 为有效 ISO 时间', async ({ request }) => {
      const profile = await createProfileViaAPI(request)

      const parsed = Date.parse(profile.created_at)
      expect(isNaN(parsed)).toBe(false)

      // 在最近 60 秒内
      const now = Date.now()
      expect(now - parsed).toBeLessThan(60_000)
      expect(now - parsed).toBeGreaterThanOrEqual(0)
    })

    test('Profile 在创建后出现、删除后消失', async ({ page, request }) => {
      await navigateToBrowser(page)

      // 通过 UI 创建一个 profile（createProfileUI 会等待 201 响应）
      const profileName = UNIQUE()
      await createProfileUI(page, profileName)

      // 创建后该 profile 出现在列表中
      const item = page.getByTestId('browser-profile-item').filter({ hasText: profileName })
      await expect(item).toBeVisible({ timeout: 5_000 })

      // 选中后删除
      await item.click()
      page.once('dialog', (d) => d.accept())
      const deletePromise = page.waitForResponse(
        (r) => r.url().includes('/api/browser-profiles/') && r.request().method() === 'DELETE',
      )
      await page.getByTestId('browser-delete-btn').click()
      await deletePromise

      // 删除后该 profile 从列表中消失
      await expect(item).not.toBeVisible({ timeout: 5_000 })
    })
  })

  test.describe('详情面板内容', () => {
    test.beforeEach(async ({ page }) => {
      await navigateToBrowser(page)
    })

    test('详情显示正确数据目录路径', async ({ page, request }) => {
      const profile = await createProfileViaAPI(request)

      await page.reload()
      await page.waitForLoadState('networkidle')

      await page.getByTestId('browser-profile-item').filter({ hasText: profile.name }).click()
      await expect(page.getByTestId('browser-profile-detail')).toBeVisible()

      // 验证文本含 browser-profiles/{id}/
      await expect(page.getByText(`browser-profiles/${profile.id}/`)).toBeVisible()
    })

    test('启动按钮触发 launch API', async ({ page, request }) => {
      const profile = await createProfileViaAPI(request)

      await page.reload()
      await page.waitForLoadState('networkidle')

      await page.getByTestId('browser-profile-item').filter({ hasText: profile.name }).click()
      await expect(page.getByTestId('browser-profile-detail')).toBeVisible()

      // 拦截 POST /launch 请求
      const requestPromise = page.waitForRequest(
        (req) => req.url().includes(`/api/browser-profiles/${profile.id}/launch`) && req.method() === 'POST'
      )

      await page.getByTestId('browser-launch-btn').click()

      const req = await requestPromise
      expect(req.url()).toContain(`/api/browser-profiles/${profile.id}/launch`)
    })
  })
})
