import type { TimelineItem, ToolUseItem } from '@/hooks/useChat'

export type RenderableTimelineItem =
  | {
    id: string
    kind: 'tool_use_group'
    items: ToolUseItem[]
  }
  | TimelineItem

export function buildRenderableTimeline(items: TimelineItem[]): RenderableTimelineItem[] {
  const result: RenderableTimelineItem[] = []

  for (const item of items) {
    if (item.kind !== 'tool_use') {
      result.push(item)
      continue
    }

    const last = result[result.length - 1]
    if (last?.kind === 'tool_use_group') {
      last.items.push({
        id: item.id,
        name: item.name,
        input: item.input,
        status: item.status,
      })
      continue
    }

    result.push({
      id: `tool-group:${item.id}`,
      kind: 'tool_use_group',
      items: [{
        id: item.id,
        name: item.name,
        input: item.input,
        status: item.status,
      }],
    })
  }

  return result
}
