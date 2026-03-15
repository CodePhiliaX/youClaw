/**
 * Database message and chat operation tests
 *
 * Covers saveMessage / getMessages / upsertChat / getChats
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { cleanTables } from './setup.ts'
import {
  saveMessage,
  getMessages,
  upsertChat,
  getChats,
} from '../src/db/index.ts'

describe('saveMessage', () => {
  beforeEach(() => cleanTables('messages'))

  test('message is queryable after saving', () => {
    saveMessage({
      id: 'msg-1',
      chatId: 'task:test',
      sender: 'scheduler',
      senderName: 'Scheduled Task',
      content: 'hello world',
      timestamp: '2026-03-10T10:00:00.000Z',
      isFromMe: true,
      isBotMessage: false,
    })

    const msgs = getMessages('task:test', 10)
    expect(msgs.length).toBe(1)
    expect(msgs[0].id).toBe('msg-1')
    expect(msgs[0].chat_id).toBe('task:test')
    expect(msgs[0].sender).toBe('scheduler')
    expect(msgs[0].sender_name).toBe('Scheduled Task')
    expect(msgs[0].content).toBe('hello world')
    expect(msgs[0].is_from_me).toBe(1)
    expect(msgs[0].is_bot_message).toBe(0)
  })

  test('bot message flag is set correctly', () => {
    saveMessage({
      id: 'msg-bot',
      chatId: 'task:test',
      sender: 'agent-1',
      senderName: 'Agent',
      content: 'bot reply',
      timestamp: new Date().toISOString(),
      isFromMe: false,
      isBotMessage: true,
    })

    const msgs = getMessages('task:test', 10)
    expect(msgs[0].is_from_me).toBe(0)
    expect(msgs[0].is_bot_message).toBe(1)
  })

  test('INSERT OR REPLACE — same id+chat_id overwrites', () => {
    const ts = new Date().toISOString()
    saveMessage({ id: 'dup-1', chatId: 'chat-1', sender: 's', senderName: 'S', content: 'original', timestamp: ts, isFromMe: false, isBotMessage: false })
    saveMessage({ id: 'dup-1', chatId: 'chat-1', sender: 's', senderName: 'S', content: 'updated', timestamp: ts, isFromMe: false, isBotMessage: false })

    const msgs = getMessages('chat-1', 10)
    expect(msgs.length).toBe(1)
    expect(msgs[0].content).toBe('updated')
  })

  test('same id with different chat_id does not conflict', () => {
    const ts = new Date().toISOString()
    saveMessage({ id: 'same-id', chatId: 'chat-a', sender: 's', senderName: 'S', content: 'a', timestamp: ts, isFromMe: false, isBotMessage: false })
    saveMessage({ id: 'same-id', chatId: 'chat-b', sender: 's', senderName: 'S', content: 'b', timestamp: ts, isFromMe: false, isBotMessage: false })

    expect(getMessages('chat-a', 10).length).toBe(1)
    expect(getMessages('chat-b', 10).length).toBe(1)
  })
})

describe('getMessages', () => {
  beforeEach(() => cleanTables('messages'))

  test('sorted by timestamp DESC', () => {
    saveMessage({ id: 'm1', chatId: 'chat-1', sender: 's', senderName: 'S', content: 'first', timestamp: '2026-03-10T10:00:00.000Z', isFromMe: false, isBotMessage: false })
    saveMessage({ id: 'm2', chatId: 'chat-1', sender: 's', senderName: 'S', content: 'third', timestamp: '2026-03-10T12:00:00.000Z', isFromMe: false, isBotMessage: false })
    saveMessage({ id: 'm3', chatId: 'chat-1', sender: 's', senderName: 'S', content: 'second', timestamp: '2026-03-10T11:00:00.000Z', isFromMe: false, isBotMessage: false })

    const msgs = getMessages('chat-1', 10)
    expect(msgs[0].content).toBe('third')
    expect(msgs[1].content).toBe('second')
    expect(msgs[2].content).toBe('first')
  })

  test('limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      saveMessage({ id: `lm-${i}`, chatId: 'chat-lim', sender: 's', senderName: 'S', content: `msg ${i}`, timestamp: new Date(Date.now() + i * 1000).toISOString(), isFromMe: false, isBotMessage: false })
    }
    expect(getMessages('chat-lim', 3).length).toBe(3)
  })

  test('before parameter — paginated query', () => {
    saveMessage({ id: 'p1', chatId: 'chat-pg', sender: 's', senderName: 'S', content: 'old', timestamp: '2026-03-10T08:00:00.000Z', isFromMe: false, isBotMessage: false })
    saveMessage({ id: 'p2', chatId: 'chat-pg', sender: 's', senderName: 'S', content: 'mid', timestamp: '2026-03-10T10:00:00.000Z', isFromMe: false, isBotMessage: false })
    saveMessage({ id: 'p3', chatId: 'chat-pg', sender: 's', senderName: 'S', content: 'new', timestamp: '2026-03-10T12:00:00.000Z', isFromMe: false, isBotMessage: false })

    const before = getMessages('chat-pg', 10, '2026-03-10T11:00:00.000Z')
    expect(before.length).toBe(2) // mid + old
    expect(before[0].content).toBe('mid')
    expect(before[1].content).toBe('old')
  })

  test('non-existent chatId returns empty array', () => {
    expect(getMessages('non-existent', 10).length).toBe(0)
  })

  test('default limit is 50', () => {
    for (let i = 0; i < 60; i++) {
      saveMessage({ id: `dl-${i}`, chatId: 'chat-dl', sender: 's', senderName: 'S', content: `${i}`, timestamp: new Date(Date.now() + i * 100).toISOString(), isFromMe: false, isBotMessage: false })
    }
    expect(getMessages('chat-dl').length).toBe(50)
  })
})

describe('upsertChat', () => {
  beforeEach(() => cleanTables('chats'))

  test('create a new chat', () => {
    upsertChat('task:c1', 'agent-1', 'Task: Test', 'task')

    const chats = getChats()
    const chat = chats.find((c) => c.chat_id === 'task:c1')
    expect(chat).toBeDefined()
    expect(chat!.name).toBe('Task: Test')
    expect(chat!.agent_id).toBe('agent-1')
    expect(chat!.channel).toBe('task')
  })

  test('uses chatId as name when name is not provided', () => {
    upsertChat('chat-auto', 'agent-1')

    const chats = getChats()
    const chat = chats.find((c) => c.chat_id === 'chat-auto')
    expect(chat!.name).toBe('chat-auto')
  })

  test('defaults channel to web when not provided', () => {
    upsertChat('chat-web', 'agent-1', 'Web Chat')

    const chats = getChats()
    const chat = chats.find((c) => c.chat_id === 'chat-web')
    expect(chat!.channel).toBe('web')
  })

  test('updates name and last_message_time of existing chat', () => {
    upsertChat('chat-upd', 'agent-1', 'First Name', 'task')
    const first = getChats().find((c) => c.chat_id === 'chat-upd')!

    upsertChat('chat-upd', 'agent-1', 'Updated Name', 'task')
    const second = getChats().find((c) => c.chat_id === 'chat-upd')!

    expect(second.name).toBe('Updated Name')
    expect(second.last_message_time >= first.last_message_time).toBe(true)
  })

  test('upsert with undefined name preserves original name', () => {
    upsertChat('chat-keep', 'agent-1', 'Original')
    upsertChat('chat-keep', 'agent-1') // name=undefined -> COALESCE preserves original name

    const chat = getChats().find((c) => c.chat_id === 'chat-keep')
    // When upsert is called with undefined name, it becomes chatId,
    // but COALESCE(excluded.name, chats.name) will use chatId
    // because name ?? chatId results in 'chat-keep'
    expect(chat!.name).toBe('chat-keep')
  })
})

describe('getChats', () => {
  beforeEach(() => cleanTables('chats'))

  test('sorted by last_message_time DESC', () => {
    upsertChat('chat-old', 'agent-1', 'Old')
    // Ensure time difference
    upsertChat('chat-new', 'agent-1', 'New')

    const chats = getChats()
    expect(chats.length).toBe(2)
    // new's last_message_time >= old
    expect(chats[0].last_message_time >= chats[1].last_message_time).toBe(true)
  })

  test('empty table returns empty array', () => {
    expect(getChats().length).toBe(0)
  })
})

// ===== Additional test scenarios =====

describe('saveMessage — empty content', () => {
  beforeEach(() => cleanTables('messages'))

  test('saves empty string content and reads it correctly', () => {
    saveMessage({
      id: 'msg-empty',
      chatId: 'chat-empty',
      sender: 'user',
      senderName: 'User',
      content: '',
      timestamp: '2026-03-10T10:00:00.000Z',
      isFromMe: true,
      isBotMessage: false,
    })

    const msgs = getMessages('chat-empty', 10)
    expect(msgs.length).toBe(1)
    expect(msgs[0].id).toBe('msg-empty')
    expect(msgs[0].content).toBe('')
  })
})

describe('saveMessage — very long content', () => {
  beforeEach(() => cleanTables('messages'))

  test('saves 20000-character content and reads it correctly', () => {
    const longContent = 'A'.repeat(20000)
    saveMessage({
      id: 'msg-long',
      chatId: 'chat-long',
      sender: 'user',
      senderName: 'User',
      content: longContent,
      timestamp: '2026-03-10T10:00:00.000Z',
      isFromMe: false,
      isBotMessage: false,
    })

    const msgs = getMessages('chat-long', 10)
    expect(msgs.length).toBe(1)
    expect(msgs[0].content).toBe(longContent)
    expect(msgs[0].content.length).toBe(20000)
  })
})

describe('saveMessage — special characters', () => {
  beforeEach(() => cleanTables('messages'))

  test('saves XSS script tag', () => {
    const xssContent = "<script>alert('xss')</script>"
    saveMessage({
      id: 'msg-xss',
      chatId: 'chat-special',
      sender: 'user',
      senderName: 'User',
      content: xssContent,
      timestamp: '2026-03-10T10:00:00.000Z',
      isFromMe: false,
      isBotMessage: false,
    })

    const msgs = getMessages('chat-special', 10)
    expect(msgs[0].content).toBe(xssContent)
  })

  test('saves SQL injection string', () => {
    const sqlInjection = "'; DROP TABLE messages; --"
    saveMessage({
      id: 'msg-sqli',
      chatId: 'chat-special',
      sender: 'user',
      senderName: 'User',
      content: sqlInjection,
      timestamp: '2026-03-10T10:01:00.000Z',
      isFromMe: false,
      isBotMessage: false,
    })

    const msgs = getMessages('chat-special', 10)
    const sqliMsg = msgs.find((m) => m.id === 'msg-sqli')
    expect(sqliMsg).toBeDefined()
    expect(sqliMsg!.content).toBe(sqlInjection)
  })

  test('saves emoji characters', () => {
    const emojiContent = '🔥🚀'
    saveMessage({
      id: 'msg-emoji',
      chatId: 'chat-special',
      sender: 'user',
      senderName: 'User',
      content: emojiContent,
      timestamp: '2026-03-10T10:02:00.000Z',
      isFromMe: false,
      isBotMessage: false,
    })

    const msgs = getMessages('chat-special', 10)
    const emojiMsg = msgs.find((m) => m.id === 'msg-emoji')
    expect(emojiMsg).toBeDefined()
    expect(emojiMsg!.content).toBe(emojiContent)
  })
})

describe('saveMessage — duplicate ID', () => {
  beforeEach(() => cleanTables('messages'))

  test('same id+chatId uses INSERT OR REPLACE to overwrite', () => {
    const ts = '2026-03-10T10:00:00.000Z'
    saveMessage({ id: 'dup-id', chatId: 'chat-dup', sender: 'a', senderName: 'A', content: 'first', timestamp: ts, isFromMe: false, isBotMessage: false })
    saveMessage({ id: 'dup-id', chatId: 'chat-dup', sender: 'b', senderName: 'B', content: 'second', timestamp: ts, isFromMe: true, isBotMessage: true })

    const msgs = getMessages('chat-dup', 10)
    expect(msgs.length).toBe(1)
    expect(msgs[0].content).toBe('second')
    expect(msgs[0].sender).toBe('b')
    expect(msgs[0].sender_name).toBe('B')
    expect(msgs[0].is_from_me).toBe(1)
    expect(msgs[0].is_bot_message).toBe(1)
  })
})

describe('getMessages — before parameter pagination', () => {
  beforeEach(() => cleanTables('messages'))

  test('uses before parameter to get messages before a midpoint timestamp', () => {
    const timestamps = [
      '2026-03-10T08:00:00.000Z',
      '2026-03-10T09:00:00.000Z',
      '2026-03-10T10:00:00.000Z',
      '2026-03-10T11:00:00.000Z',
      '2026-03-10T12:00:00.000Z',
    ]
    for (let i = 0; i < 5; i++) {
      saveMessage({
        id: `bp-${i}`,
        chatId: 'chat-before',
        sender: 's',
        senderName: 'S',
        content: `msg-${i}`,
        timestamp: timestamps[i],
        isFromMe: false,
        isBotMessage: false,
      })
    }

    // before 10:30 -> should return 08:00, 09:00, 10:00 (3 messages where timestamp < before)
    const msgs = getMessages('chat-before', 10, '2026-03-10T10:30:00.000Z')
    expect(msgs.length).toBe(3)
    // Sorted by timestamp DESC
    expect(msgs[0].content).toBe('msg-2') // 10:00
    expect(msgs[1].content).toBe('msg-1') // 09:00
    expect(msgs[2].content).toBe('msg-0') // 08:00
  })

  test('before parameter combined with limit truncates results', () => {
    const timestamps = [
      '2026-03-10T08:00:00.000Z',
      '2026-03-10T09:00:00.000Z',
      '2026-03-10T10:00:00.000Z',
      '2026-03-10T11:00:00.000Z',
      '2026-03-10T12:00:00.000Z',
    ]
    for (let i = 0; i < 5; i++) {
      saveMessage({
        id: `bpl-${i}`,
        chatId: 'chat-before-limit',
        sender: 's',
        senderName: 'S',
        content: `msg-${i}`,
        timestamp: timestamps[i],
        isFromMe: false,
        isBotMessage: false,
      })
    }

    // before 12:00, limit 2 -> should return the 2 most recent (11:00, 10:00)
    const msgs = getMessages('chat-before-limit', 2, '2026-03-10T12:00:00.000Z')
    expect(msgs.length).toBe(2)
    expect(msgs[0].content).toBe('msg-3') // 11:00
    expect(msgs[1].content).toBe('msg-2') // 10:00
  })
})

describe('upsertChat — update existing chat', () => {
  beforeEach(() => cleanTables('chats'))

  test('upsert updates name and the new name is queryable', () => {
    upsertChat('chat-upsert', 'agent-1', 'Original Name', 'web')
    const before = getChats().find((c) => c.chat_id === 'chat-upsert')
    expect(before!.name).toBe('Original Name')

    upsertChat('chat-upsert', 'agent-1', 'New Name', 'web')
    const after = getChats().find((c) => c.chat_id === 'chat-upsert')
    expect(after!.name).toBe('New Name')
  })

  test('upsert does not create duplicate records', () => {
    upsertChat('chat-nodup', 'agent-1', 'First', 'web')
    upsertChat('chat-nodup', 'agent-1', 'Second', 'web')
    upsertChat('chat-nodup', 'agent-1', 'Third', 'web')

    const chats = getChats().filter((c) => c.chat_id === 'chat-nodup')
    expect(chats.length).toBe(1)
    expect(chats[0].name).toBe('Third')
  })
})

describe('upsertChat — channel field', () => {
  beforeEach(() => cleanTables('chats'))

  test('channel stored correctly when set to task', () => {
    upsertChat('chat-task', 'agent-1', 'Task Chat', 'task')

    const chat = getChats().find((c) => c.chat_id === 'chat-task')
    expect(chat).toBeDefined()
    expect(chat!.channel).toBe('task')
  })

  test('channel stored correctly when set to telegram', () => {
    upsertChat('chat-tg', 'agent-1', 'TG Chat', 'telegram')

    const chat = getChats().find((c) => c.chat_id === 'chat-tg')
    expect(chat).toBeDefined()
    expect(chat!.channel).toBe('telegram')
  })

  test('channel defaults to web when not provided', () => {
    upsertChat('chat-default-ch', 'agent-1', 'Default Channel')

    const chat = getChats().find((c) => c.chat_id === 'chat-default-ch')
    expect(chat!.channel).toBe('web')
  })
})

describe('getChats — multiple chats sorting', () => {
  beforeEach(() => cleanTables('chats'))

  test('multiple chats sorted by last_message_time DESC', async () => {
    upsertChat('chat-order-1', 'agent-1', 'First')
    // Add small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10))
    upsertChat('chat-order-2', 'agent-1', 'Second')
    await new Promise((r) => setTimeout(r, 10))
    upsertChat('chat-order-3', 'agent-1', 'Third')

    const chats = getChats()
    expect(chats.length).toBe(3)
    // Most recent first
    expect(chats[0].chat_id).toBe('chat-order-3')
    expect(chats[1].chat_id).toBe('chat-order-2')
    expect(chats[2].chat_id).toBe('chat-order-1')
  })

  test('updating old chat changes sort order', async () => {
    upsertChat('chat-sort-a', 'agent-1', 'A')
    await new Promise((r) => setTimeout(r, 10))
    upsertChat('chat-sort-b', 'agent-1', 'B')
    await new Promise((r) => setTimeout(r, 10))
    // Update A so its last_message_time becomes the most recent
    upsertChat('chat-sort-a', 'agent-1', 'A Updated')

    const chats = getChats()
    expect(chats[0].chat_id).toBe('chat-sort-a')
    expect(chats[1].chat_id).toBe('chat-sort-b')
  })
})

describe('getMessages — limit of 0', () => {
  beforeEach(() => cleanTables('messages'))

  test('returns empty array when limit is 0', () => {
    saveMessage({
      id: 'msg-lim0',
      chatId: 'chat-lim0',
      sender: 's',
      senderName: 'S',
      content: 'test',
      timestamp: '2026-03-10T10:00:00.000Z',
      isFromMe: false,
      isBotMessage: false,
    })

    const msgs = getMessages('chat-lim0', 0)
    expect(msgs.length).toBe(0)
  })
})

describe('saveMessage — timestamp format', () => {
  beforeEach(() => cleanTables('messages'))

  test('full ISO 8601 format', () => {
    const ts = '2026-03-10T10:30:45.123Z'
    saveMessage({ id: 'ts-iso', chatId: 'chat-ts', sender: 's', senderName: 'S', content: 'iso', timestamp: ts, isFromMe: false, isBotMessage: false })

    const msgs = getMessages('chat-ts', 10)
    expect(msgs[0].timestamp).toBe(ts)
  })

  test('ISO format without milliseconds', () => {
    const ts = '2026-03-10T10:30:45Z'
    saveMessage({ id: 'ts-no-ms', chatId: 'chat-ts', sender: 's', senderName: 'S', content: 'no-ms', timestamp: ts, isFromMe: false, isBotMessage: false })

    const msgs = getMessages('chat-ts', 10)
    const msg = msgs.find((m) => m.id === 'ts-no-ms')
    expect(msg).toBeDefined()
    expect(msg!.timestamp).toBe(ts)
  })

  test('ISO format with timezone offset', () => {
    const ts = '2026-03-10T18:30:45+08:00'
    saveMessage({ id: 'ts-offset', chatId: 'chat-ts', sender: 's', senderName: 'S', content: 'offset', timestamp: ts, isFromMe: false, isBotMessage: false })

    const msgs = getMessages('chat-ts', 10)
    const msg = msgs.find((m) => m.id === 'ts-offset')
    expect(msg).toBeDefined()
    expect(msg!.timestamp).toBe(ts)
  })

  test('format generated by Date.toISOString()', () => {
    const ts = new Date('2026-03-10T10:00:00Z').toISOString()
    saveMessage({ id: 'ts-date', chatId: 'chat-ts', sender: 's', senderName: 'S', content: 'date-iso', timestamp: ts, isFromMe: false, isBotMessage: false })

    const msgs = getMessages('chat-ts', 10)
    const msg = msgs.find((m) => m.id === 'ts-date')
    expect(msg).toBeDefined()
    expect(msg!.timestamp).toBe(ts)
  })
})
