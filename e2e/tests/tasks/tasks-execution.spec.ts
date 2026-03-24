import { test, expect, UNIQUE, API_BASE, createTaskViaAPI, cleanupE2ETasks, navigateToTasks, getFirstAgentId, reloadTasksPage } from './helpers'

test.describe('真实执行', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToTasks(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2ETasks(request)
  })

  test('真实手动执行 + 运行日志', async ({ page, request }) => {
    // 检查是否有 ANTHROPIC_API_KEY
    const healthRes = await request.get(`${API_BASE}/api/health`)
    if (!healthRes.ok()) {
      test.skip(true, 'Server not healthy, skip real execution test')
    }

    const taskName = UNIQUE()
    await createTaskViaAPI(request, {
      name: taskName,
      prompt: '请回复"OK"',
    })

    await reloadTasksPage(page)

    // 点击任务
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await expect(page.getByText('暂无运行记录')).toBeVisible()

    // 点击"立即运行"
    const runResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/run') && r.request().method() === 'POST',
      { timeout: 120_000 }
    )
    await page.getByTestId('task-run-btn').click()
    const runResponse = await runResponsePromise
    const runResult = await runResponse.json()
    expect(runResult.status).toBe('success')

    // reload 获取最新数据后重新点击
    await reloadTasksPage(page)
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    // 验证 "No runs yet" 消失
    await expect(page.getByText('暂无运行记录')).not.toBeVisible()

    // 验证至少出现 1 个 task-log-item
    await expect(page.getByTestId('task-log-item').first()).toBeVisible()
  })

  test('手动执行后运行日志包含 delivery_status', async ({ request }) => {
    const healthRes = await request.get(`${API_BASE}/api/health`)
    if (!healthRes.ok()) {
      test.skip(true, 'Server not healthy, skip real execution test')
    }

    const taskName = UNIQUE()
    const task = await createTaskViaAPI(request, {
      name: taskName,
      prompt: '请回复"OK"',
    })

    // 手动运行
    const runRes = await request.post(`${API_BASE}/api/tasks/${task.id}/run`)
    expect(runRes.status()).toBe(200)
    const runResult = await runRes.json()
    expect(runResult.status).toBe('success')

    // 查看运行日志
    const logsRes = await request.get(`${API_BASE}/api/tasks/${task.id}/logs`)
    expect(logsRes.status()).toBe(200)
    const logs = await logsRes.json()
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs[0].status).toBe('success')
    // 没有配置 delivery 时 delivery_status 应为 skipped 或 null
    expect(['skipped', null]).toContain(logs[0].delivery_status)
  })

  test('手动执行后消息写入对应 chat', async ({ request }) => {
    const healthRes = await request.get(`${API_BASE}/api/health`)
    if (!healthRes.ok()) {
      test.skip(true, 'Server not healthy, skip real execution test')
    }

    const taskName = UNIQUE()
    const task = await createTaskViaAPI(request, {
      name: taskName,
      prompt: '请回复"OK"',
    })

    // 手动运行
    const runRes = await request.post(`${API_BASE}/api/tasks/${task.id}/run`)
    expect(runRes.status()).toBe(200)

    // 查询 chat 列表，验证任务对应的 chat 已创建
    const chatsRes = await request.get(`${API_BASE}/api/chats`)
    expect(chatsRes.status()).toBe(200)
    const chats = await chatsRes.json()
    const taskChat = chats.find((c: any) => c.chat_id === task.chat_id)
    expect(taskChat).toBeDefined()
    expect(taskChat.channel).toBe('task')
    expect(taskChat.name).toContain('Task:')

    // 查询该 chat 的消息（路由为 /api/chats/:chatId/messages）
    const msgsRes = await request.get(`${API_BASE}/api/chats/${encodeURIComponent(task.chat_id)}/messages`)
    expect(msgsRes.status()).toBe(200)
    const msgs = await msgsRes.json()
    // 应有至少 2 条消息：user prompt + bot response
    expect(msgs.length).toBeGreaterThanOrEqual(2)
  })
})

test.describe('Delivery API 测试', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2ETasks(request)
  })

  test('创建带 deliveryMode=push 的任务', async ({ request }) => {
    const agentId = await getFirstAgentId(request)
    const res = await request.post(`${API_BASE}/api/tasks`, {
      data: {
        agentId,
        chatId: `task:${crypto.randomUUID().slice(0, 8)}`,
        prompt: `E2E delivery test ${UNIQUE()}`,
        scheduleType: 'interval',
        scheduleValue: '3600000',
        name: UNIQUE(),
        deliveryMode: 'push',
        deliveryTarget: 'tg:123456',
      },
    })
    expect(res.status()).toBe(201)
    const task = await res.json()
    expect(task.delivery_mode).toBe('push')
    expect(task.delivery_target).toBe('tg:123456')
  })

  test('deliveryMode=push 缺少 deliveryTarget → 400', async ({ request }) => {
    const agentId = await getFirstAgentId(request)
    const res = await request.post(`${API_BASE}/api/tasks`, {
      data: {
        agentId,
        chatId: `task:${crypto.randomUUID().slice(0, 8)}`,
        prompt: `E2E delivery fail ${UNIQUE()}`,
        scheduleType: 'interval',
        scheduleValue: '3600000',
        name: UNIQUE(),
        deliveryMode: 'push',
        // 故意不传 deliveryTarget
      },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('deliveryTarget')
  })

  test('更新任务的 delivery 配置', async ({ request }) => {
    const task = await createTaskViaAPI(request)

    // 添加 delivery
    const putRes = await request.put(`${API_BASE}/api/tasks/${task.id}`, {
      data: { deliveryMode: 'push', deliveryTarget: 'tg:789' },
    })
    expect(putRes.status()).toBe(200)
    const updated = await putRes.json()
    expect(updated.delivery_mode).toBe('push')
    expect(updated.delivery_target).toBe('tg:789')

    // 移除 delivery
    const putRes2 = await request.put(`${API_BASE}/api/tasks/${task.id}`, {
      data: { deliveryMode: 'none', deliveryTarget: null },
    })
    expect(putRes2.status()).toBe(200)
    const updated2 = await putRes2.json()
    expect(updated2.delivery_mode).toBe('none')
    expect(updated2.delivery_target).toBeNull()
  })

  test('克隆任务保留 delivery 配置', async ({ request }) => {
    const agentId = await getFirstAgentId(request)
    const taskName = UNIQUE()
    const createRes = await request.post(`${API_BASE}/api/tasks`, {
      data: {
        agentId,
        chatId: `task:${crypto.randomUUID().slice(0, 8)}`,
        prompt: `E2E clone delivery ${UNIQUE()}`,
        scheduleType: 'interval',
        scheduleValue: '3600000',
        name: taskName,
        deliveryMode: 'push',
        deliveryTarget: 'tg:555',
      },
    })
    expect(createRes.status()).toBe(201)
    const task = await createRes.json()

    // 克隆
    const cloneRes = await request.post(`${API_BASE}/api/tasks/${task.id}/clone`)
    expect(cloneRes.status()).toBe(201)
    const cloned = await cloneRes.json()
    expect(cloned.delivery_mode).toBe('push')
    expect(cloned.delivery_target).toBe('tg:555')
    expect(cloned.name).toBe(`${taskName} (copy)`)

    // 清理克隆的任务
    await request.delete(`${API_BASE}/api/tasks/${cloned.id}`)
  })
})

test.describe('Scheduler 自动调度测试', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2ETasks(request)
  })

  test('once 类型任务到期后被 Scheduler 自动执行', async ({ request }) => {
    const healthRes = await request.get(`${API_BASE}/api/health`)
    if (!healthRes.ok()) {
      test.skip(true, 'Server not healthy, skip scheduler test')
    }

    const taskName = UNIQUE()
    // 创建一个 5 秒后执行的 once 任务
    const runAt = new Date(Date.now() + 5_000).toISOString()
    const agentId = await getFirstAgentId(request)
    const createRes = await request.post(`${API_BASE}/api/tasks`, {
      data: {
        agentId,
        chatId: `task:${crypto.randomUUID().slice(0, 8)}`,
        prompt: '请回复"scheduler-auto-test"',
        scheduleType: 'once',
        scheduleValue: runAt,
        name: taskName,
      },
    })
    expect(createRes.status()).toBe(201)
    const task = await createRes.json()

    // Scheduler 每 30 秒 tick 一次，等待至多 90 秒让任务被执行
    // 轮询检查任务状态变为 completed 或出现运行日志
    let executed = false
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      const taskRes = await request.get(`${API_BASE}/api/tasks`)
      const tasks = await taskRes.json()
      const current = tasks.find((t: any) => t.id === task.id)
      if (current?.status === 'completed' || current?.last_run) {
        executed = true
        break
      }
      // 等 5 秒再检查
      await new Promise((r) => setTimeout(r, 5_000))
    }

    expect(executed).toBe(true)

    // 验证运行日志已生成
    const logsRes = await request.get(`${API_BASE}/api/tasks/${task.id}/logs`)
    expect(logsRes.status()).toBe(200)
    const logs = await logsRes.json()
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs[0].status).toBe('success')
  })
})
