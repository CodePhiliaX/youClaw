import { describe, expect, test } from 'bun:test'
import { buildRenderableTimeline } from '../web/src/components/chat/timeline.ts'
import type { TimelineItem } from '../web/src/hooks/useChat.ts'

describe('chat timeline rendering', () => {
  test('groups consecutive tool items and preserves surrounding order', () => {
    const items: TimelineItem[] = [
      {
        id: 'm1',
        kind: 'message',
        role: 'user',
        content: 'hello',
        timestamp: '2026-03-19T10:00:00.000Z',
      },
      {
        id: 't1',
        kind: 'tool_use',
        name: 'Read',
        input: '{"file_path":"a.txt"}',
        status: 'done',
        timestamp: '2026-03-19T10:00:01.000Z',
      },
      {
        id: 't2',
        kind: 'tool_use',
        name: 'Grep',
        input: '{"pattern":"foo"}',
        status: 'done',
        timestamp: '2026-03-19T10:00:02.000Z',
      },
      {
        id: 's1',
        kind: 'assistant_stream',
        content: 'working...',
        timestamp: '2026-03-19T10:00:03.000Z',
      },
      {
        id: 't3',
        kind: 'tool_use',
        name: 'Bash',
        input: '{"command":"echo ok"}',
        status: 'running',
        timestamp: '2026-03-19T10:00:04.000Z',
      },
    ]

    const renderable = buildRenderableTimeline(items)

    expect(renderable.map((item) => item.kind)).toEqual([
      'message',
      'tool_use_group',
      'assistant_stream',
      'tool_use_group',
    ])

    expect(renderable[1]).toMatchObject({
      kind: 'tool_use_group',
      items: [
        { name: 'Read', status: 'done' },
        { name: 'Grep', status: 'done' },
      ],
    })

    expect(renderable[3]).toMatchObject({
      kind: 'tool_use_group',
      items: [
        { name: 'Bash', status: 'running' },
      ],
    })
  })
})
