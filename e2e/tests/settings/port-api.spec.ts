import {
  test, expect,
  API_BASE,
  getPortViaAPI, setPortViaAPI, cleanupPortConfig,
} from './helpers'

test.describe('端口配置: API 测试', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPortConfig(request)
  })

  test('GET /settings/port 默认返回 null', async ({ request }) => {
    // 确保干净状态
    await cleanupPortConfig(request)
    const port = await getPortViaAPI(request)
    expect(port).toBeNull()
  })

  test('PUT /settings/port 设置有效端口', async ({ request }) => {
    const res = await request.put(`${API_BASE}/api/settings/port`, {
      data: { port: '8888' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // 验证读取回来
    const port = await getPortViaAPI(request)
    expect(port).toBe('8888')
  })

  test('PUT /settings/port 清除端口配置', async ({ request }) => {
    // 先设置一个端口
    await setPortViaAPI(request, '9999')
    expect(await getPortViaAPI(request)).toBe('9999')

    // 清除
    await setPortViaAPI(request, null)
    expect(await getPortViaAPI(request)).toBeNull()
  })

  test('PUT /settings/port 拒绝小于 1024 的端口', async ({ request }) => {
    const res = await request.put(`${API_BASE}/api/settings/port`, {
      data: { port: '80' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  test('PUT /settings/port 拒绝大于 65535 的端口', async ({ request }) => {
    const res = await request.put(`${API_BASE}/api/settings/port`, {
      data: { port: '70000' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  test('PUT /settings/port 拒绝非数字', async ({ request }) => {
    const res = await request.put(`${API_BASE}/api/settings/port`, {
      data: { port: 'abc' },
    })
    expect(res.status()).toBe(400)
  })

  test('PUT /settings/port 覆盖已有值', async ({ request }) => {
    await setPortViaAPI(request, '8000')
    expect(await getPortViaAPI(request)).toBe('8000')

    await setPortViaAPI(request, '9000')
    expect(await getPortViaAPI(request)).toBe('9000')
  })

  test('PUT /settings/port 边界值 1024 可通过', async ({ request }) => {
    await setPortViaAPI(request, '1024')
    expect(await getPortViaAPI(request)).toBe('1024')
  })

  test('PUT /settings/port 边界值 65535 可通过', async ({ request }) => {
    await setPortViaAPI(request, '65535')
    expect(await getPortViaAPI(request)).toBe('65535')
  })
})
