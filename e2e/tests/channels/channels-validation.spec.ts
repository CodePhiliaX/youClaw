import {
  test, expect, UNIQUE,
  createChannelViaAPI, deleteChannelViaAPI,
  getChannelTypesViaAPI, cleanupE2EChannels,
  navigateToChannels, API_BASE,
} from './helpers'

test.describe('Level 5: Channel 校验', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EChannels(request)
  })

  test('不选类型时提交按钮 disabled', async ({ page }) => {
    await navigateToChannels(page)
    await page.getByTestId('channel-create-btn').click()

    // 未选类型，按钮应 disabled
    await expect(page.getByTestId('channel-submit-btn')).toBeDisabled()
  })

  test('创建重复 ID 返回 400', async ({ request }) => {
    const id = `e2e-dup-${Date.now()}`
    await createChannelViaAPI(request, { id })

    // 再次创建同 ID
    const res = await request.post(`${API_BASE}/api/channels`, {
      data: {
        id,
        type: 'telegram',
        label: UNIQUE(),
        config: { botToken: 'fake' },
        enabled: false,
      },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('已存在')
  })

  test('删除不存在的 channel 返回 404', async ({ request }) => {
    const { status } = await deleteChannelViaAPI(request, 'non-existent-channel-id')
    expect(status).toBe(404)
  })

  test('获取 channel types API 返回正确的类型列表', async ({ request }) => {
    const types = await getChannelTypesViaAPI(request)
    expect(Array.isArray(types)).toBe(true)
    expect(types.length).toBeGreaterThan(0)

    // 每个类型应有基本字段
    for (const t of types) {
      expect(t).toHaveProperty('type')
      expect(t).toHaveProperty('label')
      expect(t).toHaveProperty('configFields')
      expect(Array.isArray(t.configFields)).toBe(true)
    }

    // telegram 类型应存在
    const telegram = types.find((t: { type: string }) => t.type === 'telegram')
    expect(telegram).toBeTruthy()
  })

  test('wecom 和 dingtalk 类型存在于 channel types API', async ({ request }) => {
    const types = await getChannelTypesViaAPI(request)

    const wecom = types.find((t: { type: string }) => t.type === 'wecom')
    expect(wecom).toBeTruthy()
    expect(wecom.configFields.length).toBe(5)

    const dingtalk = types.find((t: { type: string }) => t.type === 'dingtalk')
    expect(dingtalk).toBeTruthy()
    expect(dingtalk.configFields.length).toBe(2)
  })
})
