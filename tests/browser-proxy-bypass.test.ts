import { describe, expect, test } from 'bun:test'
import { withNoProxyForCdpUrl } from '../src/browser/cdp-proxy-bypass.ts'

describe('browser CDP proxy bypass', () => {
  test('temporarily adds loopback hosts to NO_PROXY for local CDP urls', async () => {
    process.env.HTTP_PROXY = 'http://127.0.0.1:7890'
    delete process.env.NO_PROXY
    delete process.env.no_proxy

    let insideNoProxy = ''
    await withNoProxyForCdpUrl('ws://127.0.0.1:18801/devtools/browser/test', async () => {
      insideNoProxy = process.env.NO_PROXY || ''
      return undefined
    })

    expect(insideNoProxy).toContain('127.0.0.1')
    expect(process.env.NO_PROXY).toBeUndefined()
    expect(process.env.no_proxy).toBeUndefined()
  })
})
