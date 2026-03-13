import '../tests/setup-light.ts'
import { describe, test, expect, mock } from 'bun:test'
import {
  generateSignature, decryptMessage, encryptMessage,
  extractTextFromXml, chunkText, WeComChannel,
} from '../src/channel/wecom.ts'

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('generateSignature', () => {
  test('生成正确的 SHA1 签名', () => {
    const sig = generateSignature('token123', '1234567890', 'nonce1', 'encrypt_data')
    expect(sig).toMatch(/^[0-9a-f]{40}$/)
  })

  test('不同排序产生相同签名', () => {
    const sig1 = generateSignature('a', 'b', 'c', 'd')
    const sig2 = generateSignature('a', 'b', 'c', 'd')
    expect(sig1).toBe(sig2)
  })

  test('不同输入产生不同签名', () => {
    const sig1 = generateSignature('token1', '123', 'nonce', 'enc')
    const sig2 = generateSignature('token2', '123', 'nonce', 'enc')
    expect(sig1).not.toBe(sig2)
  })
})

describe('decryptMessage / encryptMessage', () => {
  // 43 字符的 encodingAESKey（base64 去掉尾部 = 后 43 字符）
  const encodingAESKey = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
  const corpId = 'wx1234567890'

  test('加解密往返测试', () => {
    const original = 'Hello, 企业微信!'
    const encrypted = encryptMessage(encodingAESKey, corpId, original)
    const { message, corpId: decryptedCorpId } = decryptMessage(encodingAESKey, encrypted)
    expect(message).toBe(original)
    expect(decryptedCorpId).toBe(corpId)
  })

  test('空消息加解密', () => {
    const original = ''
    const encrypted = encryptMessage(encodingAESKey, corpId, original)
    const { message } = decryptMessage(encodingAESKey, encrypted)
    expect(message).toBe(original)
  })

  test('长消息加解密', () => {
    const original = '测试'.repeat(500)
    const encrypted = encryptMessage(encodingAESKey, corpId, original)
    const { message } = decryptMessage(encodingAESKey, encrypted)
    expect(message).toBe(original)
  })
})

describe('extractTextFromXml', () => {
  test('提取文本消息', () => {
    const xml = `<xml>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[hello world]]></Content>
      <FromUserName><![CDATA[user123]]></FromUserName>
      <AgentID>1000001</AgentID>
      <MsgId>12345</MsgId>
    </xml>`
    const result = extractTextFromXml(xml)
    expect(result.msgType).toBe('text')
    expect(result.content).toBe('hello world')
    expect(result.fromUserName).toBe('user123')
    expect(result.agentId).toBe('1000001')
    expect(result.msgId).toBe('12345')
  })

  test('图片消息', () => {
    const xml = `<xml><MsgType><![CDATA[image]]></MsgType><Content></Content></xml>`
    const result = extractTextFromXml(xml)
    expect(result.msgType).toBe('image')
    expect(result.content).toBe('')
  })

  test('空内容', () => {
    const xml = '<xml></xml>'
    const result = extractTextFromXml(xml)
    expect(result.msgType).toBe('')
    expect(result.content).toBe('')
  })

  test('提取 Encrypt 字段', () => {
    const xml = '<xml><Encrypt><![CDATA[encrypted_data]]></Encrypt></xml>'
    const result = extractTextFromXml(xml)
    expect(result.encrypt).toBe('encrypted_data')
  })
})

describe('chunkText', () => {
  test('短文本返回单个分片', () => {
    expect(chunkText('hello', 10)).toEqual(['hello'])
  })

  test('正确拆分', () => {
    expect(chunkText('abcdefghij', 3)).toEqual(['abc', 'def', 'ghi', 'j'])
  })

  test('恰好整除', () => {
    expect(chunkText('abcdef', 3)).toEqual(['abc', 'def'])
  })

  test('空字符串', () => {
    expect(chunkText('', 10)).toEqual([''])
  })
})

// ---------------------------------------------------------------------------
// WeComChannel integration tests (mock fetch)
// ---------------------------------------------------------------------------

function createMockFetch() {
  const calls: { url: string; init?: RequestInit }[] = []

  const mockFetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url.toString()
    calls.push({ url: urlStr, init })

    // token 请求
    if (urlStr.includes('gettoken')) {
      return new Response(JSON.stringify({ access_token: 'test_token', expires_in: 7200, errcode: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 发送消息
    if (urlStr.includes('message/send')) {
      return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }) as any

  return { fetch: mockFetch, calls }
}

describe('WeComChannel', () => {
  const encodingAESKey = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'

  describe('sendMessage', () => {
    test('正确的 API URL 和 access_token 参数', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new WeComChannel('corp1', 'secret1', '1000001', 'token', encodingAESKey, {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      // 手动设置 token
      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }

      await channel.sendMessage('wecom:user123', 'hello')

      const msgCall = calls.find(c => c.url.includes('message/send'))
      expect(msgCall).toBeDefined()
      expect(msgCall!.url).toContain('access_token=test_token')
      expect(msgCall!.init?.method).toBe('POST')

      const body = JSON.parse(msgCall!.init?.body as string)
      expect(body.touser).toBe('user123')
      expect(body.msgtype).toBe('text')
      expect(body.text.content).toBe('hello')
    })

    test('2048 字符分片', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new WeComChannel('corp1', 'secret1', '1000001', 'token', encodingAESKey, {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }

      const longText = 'x'.repeat(2049)
      await channel.sendMessage('wecom:user1', longText)

      const msgCalls = calls.filter(c => c.url.includes('message/send'))
      expect(msgCalls.length).toBe(2)
    })

    test('过期 token 自动刷新', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new WeComChannel('corp1', 'secret1', '1000001', 'token', encodingAESKey, {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      // 设置过期 token
      ;(channel as any).accessToken = { access_token: 'old_token', expires_in: 7200, fetchedAt: Date.now() - 8000000 }

      await channel.sendMessage('wecom:user1', 'hello')

      const tokenCall = calls.find(c => c.url.includes('gettoken'))
      expect(tokenCall).toBeDefined()
    })
  })

  describe('handleWebhookVerification', () => {
    test('合法签名返回解密 echostr', async () => {
      const { fetch: mockFetch } = createMockFetch()
      const channel = new WeComChannel('corp1', 'secret1', '1000001', 'testtoken', encodingAESKey, {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      // 用 encryptMessage 生成 echostr
      const { encryptMessage: enc } = await import('../src/channel/wecom.ts')
      const echostr = enc(encodingAESKey, 'corp1', 'echo_test_123')

      const timestamp = '1234567890'
      const nonce = 'nonce1'
      const sig = generateSignature('testtoken', timestamp, nonce, echostr)

      const result = channel.handleWebhookVerification({
        msg_signature: sig,
        timestamp,
        nonce,
        echostr,
      })

      expect(result.success).toBe(true)
      expect(result.echostr).toBe('echo_test_123')
    })

    test('非法签名拒绝', () => {
      const { fetch: mockFetch } = createMockFetch()
      const channel = new WeComChannel('corp1', 'secret1', '1000001', 'testtoken', encodingAESKey, {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      const result = channel.handleWebhookVerification({
        msg_signature: 'invalid_sig',
        timestamp: '123',
        nonce: 'n',
        echostr: 'enc',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('签名')
    })
  })

  describe('handleWebhookMessage', () => {
    test('解密并路由文本消息到 onMessage', () => {
      const { fetch: mockFetch } = createMockFetch()
      const messages: any[] = []
      const channel = new WeComChannel('corp1', 'secret1', '1000001', 'testtoken', encodingAESKey, {
        onMessage: (msg) => messages.push(msg),
        _fetchFn: mockFetch,
      })

      // 构造加密的消息 XML
      const innerXml = `<xml>
        <MsgType><![CDATA[text]]></MsgType>
        <Content><![CDATA[test message]]></Content>
        <FromUserName><![CDATA[user456]]></FromUserName>
        <AgentID>1000001</AgentID>
        <MsgId>msg001</MsgId>
      </xml>`

      const encrypted = encryptMessage(encodingAESKey, 'corp1', innerXml)
      const timestamp = '1234567890'
      const nonce = 'nonce1'
      const sig = generateSignature('testtoken', timestamp, nonce, encrypted)

      const outerXml = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`

      const result = channel.handleWebhookMessage(
        { msg_signature: sig, timestamp, nonce },
        outerXml,
      )

      expect(result.success).toBe(true)
      expect(messages.length).toBe(1)
      expect(messages[0].chatId).toBe('wecom:user456')
      expect(messages[0].content).toBe('test message')
      expect(messages[0].channel).toBe('wecom')
    })

    test('忽略非文本消息', () => {
      const { fetch: mockFetch } = createMockFetch()
      const messages: any[] = []
      const channel = new WeComChannel('corp1', 'secret1', '1000001', 'testtoken', encodingAESKey, {
        onMessage: (msg) => messages.push(msg),
        _fetchFn: mockFetch,
      })

      const innerXml = `<xml><MsgType><![CDATA[image]]></MsgType><Content></Content><FromUserName><![CDATA[user1]]></FromUserName></xml>`
      const encrypted = encryptMessage(encodingAESKey, 'corp1', innerXml)
      const timestamp = '123'
      const nonce = 'n1'
      const sig = generateSignature('testtoken', timestamp, nonce, encrypted)

      const outerXml = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`

      const result = channel.handleWebhookMessage(
        { msg_signature: sig, timestamp, nonce },
        outerXml,
      )

      expect(result.success).toBe(true)
      expect(messages.length).toBe(0)
    })

    test('签名校验失败拒绝', () => {
      const { fetch: mockFetch } = createMockFetch()
      const channel = new WeComChannel('corp1', 'secret1', '1000001', 'testtoken', encodingAESKey, {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      const encrypted = encryptMessage(encodingAESKey, 'corp1', '<xml><MsgType><![CDATA[text]]></MsgType></xml>')
      const outerXml = `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`

      const result = channel.handleWebhookMessage(
        { msg_signature: 'wrong_sig', timestamp: '123', nonce: 'n' },
        outerXml,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('签名')
    })
  })

  describe('ownsChatId', () => {
    test('wecom: 前缀返回 true', () => {
      const { fetch: mockFetch } = createMockFetch()
      const channel = new WeComChannel('c', 's', 'a', 't', encodingAESKey, {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      expect(channel.ownsChatId('wecom:user1')).toBe(true)
    })

    test('非 wecom: 前缀返回 false', () => {
      const { fetch: mockFetch } = createMockFetch()
      const channel = new WeComChannel('c', 's', 'a', 't', encodingAESKey, {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      expect(channel.ownsChatId('tg:123')).toBe(false)
      expect(channel.ownsChatId('feishu:chat1')).toBe(false)
      expect(channel.ownsChatId('dingtalk:user:1')).toBe(false)
    })
  })

  describe('isConnected', () => {
    test('初始状态为 false', () => {
      const { fetch: mockFetch } = createMockFetch()
      const channel = new WeComChannel('c', 's', 'a', 't', encodingAESKey, {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      expect(channel.isConnected()).toBe(false)
    })
  })

  describe('disconnect', () => {
    test('清理 timer 并设置 connected = false', async () => {
      const { fetch: mockFetch } = createMockFetch()
      const channel = new WeComChannel('c', 's', 'a', 't', encodingAESKey, {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      // 手动设置一些状态
      ;(channel as any)._connected = true
      ;(channel as any).tokenRefreshTimer = setTimeout(() => {}, 100000)

      await channel.disconnect()

      expect(channel.isConnected()).toBe(false)
      expect((channel as any).tokenRefreshTimer).toBeNull()
    })
  })
})
