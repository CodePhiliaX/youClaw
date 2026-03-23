import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cleanTables } from './setup.ts'
import { ChannelManager } from '../src/channel/manager.ts'
import { createChannelRecord, getChannelRecord } from '../src/db/index.ts'
import {
  deriveRawAccountId,
  listIndexedWeixinAccountIds,
  registerWeixinAccountId,
  saveWeixinAccount,
} from '../src/openclaw-plugins/openclaw-weixin/src/auth/accounts.ts'
import { resolveStateDir } from '../src/openclaw-plugins/openclaw-weixin/src/storage/state-dir.ts'
import { getSyncBufFilePath } from '../src/openclaw-plugins/openclaw-weixin/src/storage/sync-buf.ts'

function createChannelManager() {
  return new ChannelManager(
    {
      addChannel: () => {},
      removeChannel: () => {},
    } as any,
    () => {},
  )
}

function resolveWeixinAccountsDir() {
  return path.join(resolveStateDir(), 'openclaw-weixin', 'accounts')
}

function seedWechatPersonalState(stateKey: string, linkedAccountId: string, opts?: { rawCompat?: boolean }) {
  const syncBufPath = getSyncBufFilePath(stateKey)
  const accountFilePath = path.join(resolveWeixinAccountsDir(), `${stateKey}.json`)

  saveWeixinAccount(stateKey, { token: 'secret-token', linkedAccountId })
  registerWeixinAccountId(stateKey)
  mkdirSync(path.dirname(syncBufPath), { recursive: true })
  writeFileSync(syncBufPath, JSON.stringify({ get_updates_buf: 'cursor-1' }))

  if (opts?.rawCompat) {
    const rawAccountId = deriveRawAccountId(stateKey)
    if (rawAccountId) {
      const rawSyncBufPath = getSyncBufFilePath(rawAccountId)
      const rawAccountFilePath = path.join(resolveWeixinAccountsDir(), `${rawAccountId}.json`)
      mkdirSync(path.dirname(rawAccountFilePath), { recursive: true })
      writeFileSync(rawAccountFilePath, JSON.stringify({ token: 'legacy-token', linkedAccountId }))
      writeFileSync(rawSyncBufPath, JSON.stringify({ get_updates_buf: 'legacy-cursor' }))
    }
  }

  return { syncBufPath, accountFilePath }
}

describe('ChannelManager wechat-personal auth lifecycle', () => {
  beforeEach(() => {
    cleanTables('channels', 'kv_state')
    rmSync(resolveStateDir(), { recursive: true, force: true })
  })

  test('deleting a wechat-personal channel clears persisted login state', async () => {
    const channelId = 'wechat-personal-main'
    const linkedAccountId = 'bot-im-bot'
    const { syncBufPath, accountFilePath } = seedWechatPersonalState(channelId, linkedAccountId)

    createChannelRecord({
      id: channelId,
      type: 'wechat-personal',
      label: 'WeChat Personal',
      config: JSON.stringify({ accountId: linkedAccountId }),
      enabled: false,
    })

    await createChannelManager().deleteChannel(channelId)

    expect(getChannelRecord(channelId)).toBeNull()
    expect(existsSync(accountFilePath)).toBe(false)
    expect(existsSync(syncBufPath)).toBe(false)
    expect(listIndexedWeixinAccountIds()).not.toContain(channelId)
  })

  test('deleting a wechat-personal channel also clears legacy raw-id login files', async () => {
    const channelId = 'legacy-im-bot'
    const linkedAccountId = 'legacy-linked-im-bot'
    const rawAccountId = deriveRawAccountId(channelId)
    seedWechatPersonalState(channelId, linkedAccountId, { rawCompat: true })
    const rawSyncBufPath = getSyncBufFilePath(rawAccountId!)
    const rawAccountFilePath = path.join(resolveWeixinAccountsDir(), `${rawAccountId}.json`)

    createChannelRecord({
      id: channelId,
      type: 'wechat-personal',
      label: 'WeChat Personal Legacy',
      config: JSON.stringify({ accountId: linkedAccountId }),
      enabled: false,
    })

    await createChannelManager().deleteChannel(channelId)

    expect(getChannelRecord(channelId)).toBeNull()
    expect(existsSync(rawAccountFilePath)).toBe(false)
    expect(existsSync(rawSyncBufPath)).toBe(false)
  })

  test('logout clears persisted login state but keeps the channel record', async () => {
    const channelId = 'wechat-personal-logout'
    const linkedAccountId = 'logout-im-bot'
    const { syncBufPath, accountFilePath } = seedWechatPersonalState(channelId, linkedAccountId)

    createChannelRecord({
      id: channelId,
      type: 'wechat-personal',
      label: 'WeChat Personal Logout',
      config: JSON.stringify({ accountId: linkedAccountId }),
      enabled: false,
    })

    const result = await createChannelManager().logoutChannel(channelId)
    const record = getChannelRecord(channelId)
    const config = JSON.parse(record!.config) as { accountId?: string }

    expect(result.cleared).toBe(true)
    expect(record).not.toBeNull()
    expect(config.accountId).toBe('')
    expect(existsSync(accountFilePath)).toBe(false)
    expect(existsSync(syncBufPath)).toBe(false)
    expect(listIndexedWeixinAccountIds()).not.toContain(channelId)
  })

  test('disconnect keeps persisted login state intact', async () => {
    const channelId = 'wechat-personal-disconnect'
    const linkedAccountId = 'disconnect-im-bot'
    const { syncBufPath, accountFilePath } = seedWechatPersonalState(channelId, linkedAccountId)

    createChannelRecord({
      id: channelId,
      type: 'wechat-personal',
      label: 'WeChat Personal Disconnect',
      config: JSON.stringify({ accountId: linkedAccountId }),
      enabled: false,
    })

    await createChannelManager().disconnectChannel(channelId)

    expect(getChannelRecord(channelId)).not.toBeNull()
    expect(existsSync(accountFilePath)).toBe(true)
    expect(existsSync(syncBufPath)).toBe(true)
    expect(listIndexedWeixinAccountIds()).toContain(channelId)
  })

  test('enabling a logged-out wechat-personal channel leaves it idle without a connection error', async () => {
    createChannelRecord({
      id: 'wechat-personal-enable',
      type: 'wechat-personal',
      label: 'WeChat Personal Enable',
      config: JSON.stringify({}),
      enabled: false,
    })

    const manager = createChannelManager()
    await manager.updateChannel('wechat-personal-enable', { enabled: true })
    await Promise.resolve()

    expect(manager.getStatuses()).toContainEqual({
      id: 'wechat-personal-enable',
      type: 'wechat-personal',
      label: 'WeChat Personal Enable',
      connected: false,
      enabled: true,
      error: undefined,
      configuredFields: [],
    })
  })

  test('wechat-personal channels do not share login state when linked to the same remote account', async () => {
    const linkedAccountId = 'shared-remote-im-bot'
    seedWechatPersonalState('wechat-personal-a', linkedAccountId)

    createChannelRecord({
      id: 'wechat-personal-a',
      type: 'wechat-personal',
      label: 'WeChat Personal A',
      config: JSON.stringify({ accountId: linkedAccountId }),
      enabled: false,
    })
    createChannelRecord({
      id: 'wechat-personal-b',
      type: 'wechat-personal',
      label: 'WeChat Personal B',
      config: JSON.stringify({ accountId: linkedAccountId }),
      enabled: false,
    })

    const manager = createChannelManager()
    const statusA = await manager.getChannelAuthStatus('wechat-personal-a')
    const statusB = await manager.getChannelAuthStatus('wechat-personal-b')

    expect(statusA.loggedIn).toBe(true)
    expect(statusA.accountLabel).toBe(linkedAccountId)
    expect(statusB.loggedIn).toBe(false)
  })

  test('legacy shared login state is migrated to the channel-specific state key on access', async () => {
    const channelId = 'wechat-personal-migrated'
    const linkedAccountId = 'legacy-shared-im-bot'
    const migratedAccountFilePath = path.join(resolveWeixinAccountsDir(), `${channelId}.json`)
    const migratedSyncBufPath = getSyncBufFilePath(channelId)

    saveWeixinAccount(linkedAccountId, { token: 'legacy-token', linkedAccountId })
    registerWeixinAccountId(linkedAccountId)
    mkdirSync(path.dirname(migratedSyncBufPath), { recursive: true })
    writeFileSync(getSyncBufFilePath(linkedAccountId), JSON.stringify({ get_updates_buf: 'legacy-cursor' }))

    createChannelRecord({
      id: channelId,
      type: 'wechat-personal',
      label: 'WeChat Personal Migrated',
      config: JSON.stringify({ accountId: linkedAccountId }),
      enabled: false,
    })

    const manager = createChannelManager()
    const status = await manager.getChannelAuthStatus(channelId)

    expect(status.loggedIn).toBe(true)
    expect(status.accountLabel).toBe(linkedAccountId)
    expect(existsSync(migratedAccountFilePath)).toBe(true)
    expect(existsSync(migratedSyncBufPath)).toBe(true)
    expect(listIndexedWeixinAccountIds()).toContain(channelId)
  })
})
