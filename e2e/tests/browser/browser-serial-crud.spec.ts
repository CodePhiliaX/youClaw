import {
  test, expect, UNIQUE, API_BASE,
  createProfileViaAPI, getProfilesViaAPI, deleteProfileViaAPI,
  cleanupE2EProfiles, navigateToBrowser, createProfileUI,
} from './helpers'

test.describe('Browser Profiles: 串行 CRUD 全流程', () => {
  test.describe.configure({ mode: 'serial' })

  // 使用 SERIAL 前缀避免被其他测试的 cleanupE2EProfiles 清理
  const PREFIX = 'SERIAL'
  let profileName: string
  let profileId: string

  test.beforeAll(async ({ request }) => {
    // 清理以 SERIAL 开头的残留
    const profiles = await getProfilesViaAPI(request)
    for (const p of profiles) {
      if (p.name.startsWith(PREFIX)) {
        await deleteProfileViaAPI(request, p.id).catch(() => {})
      }
    }
  })

  test.afterAll(async ({ request }) => {
    const profiles = await getProfilesViaAPI(request)
    for (const p of profiles) {
      if (p.name.startsWith(PREFIX)) {
        await deleteProfileViaAPI(request, p.id).catch(() => {})
      }
    }
  })

  test('通过 UI 创建 Profile', async ({ page, request }) => {
    await navigateToBrowser(page)

    profileName = `${PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    await createProfileUI(page, profileName)

    // 验证列表可见
    await expect(page.getByTestId('browser-profile-item').filter({ hasText: profileName })).toBeVisible({ timeout: 5_000 })

    // API 查询获取 ID
    const profiles = await getProfilesViaAPI(request)
    const created = profiles.find((p) => p.name === profileName)
    expect(created).toBeDefined()
    profileId = created!.id
  })

  test('查看详情面板', async ({ page }) => {
    await navigateToBrowser(page)

    // 等待列表加载出该 profile
    await expect(page.getByTestId('browser-profile-item').filter({ hasText: profileName })).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('browser-profile-item').filter({ hasText: profileName }).click()

    // 验证详情面板内容
    await expect(page.getByTestId('browser-profile-detail')).toBeVisible()
    await expect(page.getByTestId('browser-profile-name')).toHaveText(profileName)
    await expect(page.getByTestId('browser-launch-btn')).toBeVisible()
    await expect(page.getByTestId('browser-delete-btn')).toBeVisible()

    // data dir 路径包含 profile ID
    await expect(page.getByText(`browser-profiles/${profileId}/`)).toBeVisible()
  })

  test('删除 Profile', async ({ page, request }) => {
    await navigateToBrowser(page)

    await expect(page.getByTestId('browser-profile-item').filter({ hasText: profileName })).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('browser-profile-item').filter({ hasText: profileName }).click()

    // 注册 dialog accept
    page.once('dialog', (d) => d.accept())

    const deletePromise = page.waitForResponse(
      (r) => r.url().includes('/api/browser-profiles/') && r.request().method() === 'DELETE',
    )

    await page.getByTestId('browser-delete-btn').click()
    await deletePromise

    // 验证从列表消失
    await expect(page.getByTestId('browser-profile-item').filter({ hasText: profileName })).not.toBeVisible()

    // API 确认已删除
    const profiles = await getProfilesViaAPI(request)
    expect(profiles.find((p) => p.id === profileId)).toBeUndefined()
  })
})
