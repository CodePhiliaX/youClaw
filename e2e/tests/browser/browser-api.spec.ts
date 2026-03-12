import {
  test, expect, UNIQUE,
  createProfileViaAPI, getProfilesViaAPI, deleteProfileViaAPI,
  cleanupE2EProfiles,
} from './helpers'

const API_BASE = 'http://localhost:3000'

test.describe('Browser Profiles: API 测试', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EProfiles(request)
  })

  test('GET /api/browser-profiles 返回数组', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/browser-profiles`)
    expect(res.status()).toBe(200)
    const profiles = await res.json()
    expect(Array.isArray(profiles)).toBe(true)
  })

  test('POST /api/browser-profiles 创建成功', async ({ request }) => {
    const name = `E2E-api-create-${Date.now()}`
    const res = await request.post(`${API_BASE}/api/browser-profiles`, {
      data: { name },
    })
    expect(res.status()).toBe(201)
    const profile = await res.json()
    expect(profile.name).toBe(name)
    expect(profile.id).toBeTruthy()
    expect(profile.created_at).toBeTruthy()
  })

  test('POST /api/browser-profiles 无 name 返回 400', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/browser-profiles`, {
      data: {},
    })
    expect(res.status()).toBe(400)
  })

  test('DELETE /api/browser-profiles/:id 删除成功', async ({ request }) => {
    const profile = await createProfileViaAPI(request)

    const res = await request.delete(`${API_BASE}/api/browser-profiles/${profile.id}`)
    expect(res.status()).toBe(200)

    // 验证已删除
    const profiles = await getProfilesViaAPI(request)
    expect(profiles.find((p) => p.id === profile.id)).toBeUndefined()
  })

  test('DELETE /api/browser-profiles/:id 不存在返回 404', async ({ request }) => {
    const res = await request.delete(`${API_BASE}/api/browser-profiles/nonexistent-id-xyz`)
    expect(res.status()).toBe(404)
  })

  test('创建后在列表中可见', async ({ request }) => {
    const name = `E2E-api-list-${Date.now()}`
    const created = await createProfileViaAPI(request, name)

    const profiles = await getProfilesViaAPI(request)
    const found = profiles.find((p) => p.id === created.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe(name)
  })

  test('消息 API 支持 browserProfileId 字段', async ({ request }) => {
    // 创建一个 Profile
    const profile = await createProfileViaAPI(request)

    // 获取第一个 agent
    const agentsRes = await request.get(`${API_BASE}/api/agents`)
    const agents = await agentsRes.json()
    if (!agents.length) return

    const agentId = agents[0].id

    // 发送带 browserProfileId 的消息
    const res = await request.post(`${API_BASE}/api/agents/${agentId}/message`, {
      data: {
        prompt: `E2E browser profile test ${UNIQUE()}`,
        browserProfileId: profile.id,
      },
    })
    expect(res.status()).toBe(200)
    const result = await res.json()
    expect(result.chatId).toBeTruthy()
    expect(result.status).toBe('processing')
  })
})
