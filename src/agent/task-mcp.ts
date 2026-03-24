import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { getLogger } from '../logger/index.ts'
import { listTasksForAgent, applyTaskAction, TaskServiceError } from '../task/index.ts'
import type { TaskActionInput, TaskActionResult, TaskListFilters, TaskStatus, TaskWriteAction } from '../task/index.ts'

export interface TaskToolContext {
  agentId: string
  chatId: string
}

export interface TaskMcpOptions {
  service?: {
    listTasksForAgent(agentId: string, filters?: TaskListFilters): Promise<unknown[]> | unknown[]
    applyTaskAction(input: TaskActionInput): Promise<TaskActionResult> | TaskActionResult
  }
}

function ensureCreateInput(args: {
  prompt?: string
  schedule_type?: 'cron' | 'interval' | 'once'
  schedule_value?: string
}): string | null {
  if (!args.prompt) return 'create action requires prompt'
  if (!args.schedule_type) return 'create action requires schedule_type'
  if (!args.schedule_value) return 'create action requires schedule_value'
  return null
}

function ensureUpdateInput(args: {
  prompt?: string
  description?: string
  schedule_type?: 'cron' | 'interval' | 'once'
  schedule_value?: string
  timezone?: string | null
  delivery_mode?: 'none' | 'push'
  delivery_target?: string | null
}): string | null {
  if (
    args.prompt === undefined &&
    args.description === undefined &&
    args.schedule_type === undefined &&
    args.schedule_value === undefined &&
    args.timezone === undefined &&
    args.delivery_mode === undefined &&
    args.delivery_target === undefined
  ) {
    return 'update action requires at least one mutable field (prompt/schedule/timezone/delivery)'
  }
  return null
}

export function createTaskMcpServer(context: TaskToolContext, options?: TaskMcpOptions) {
  const service = options?.service ?? { listTasksForAgent, applyTaskAction }

  return createSdkMcpServer({
    name: 'task',
    version: '1.0.0',
    tools: [
      tool(
        'list_tasks',
        'List scheduled tasks for the current agent. Call this before any write operation.',
        {
          chat_id: z.string().optional().describe('Optional chat id filter'),
          name: z.string().optional().describe('Optional exact task name filter'),
          status: z.enum(['active', 'paused', 'completed']).optional().describe('Optional status filter'),
          limit: z.number().int().min(1).max(200).optional().describe('Maximum number of tasks to return'),
        },
        async (args) => {
          const logger = getLogger()
          try {
            const tasks = await service.listTasksForAgent(context.agentId, {
              chatId: args.chat_id,
              name: args.name,
              status: args.status as TaskStatus | undefined,
              limit: args.limit,
            })
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ tasks }, null, 2),
              }],
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const statusCode = err instanceof TaskServiceError ? err.statusCode : undefined
            logger.error({ error: msg, statusCode, agentId: context.agentId, chatId: context.chatId, category: 'task' }, 'list_tasks failed')
            return {
              content: [{ type: 'text' as const, text: `Failed to list tasks: ${msg}` }],
              isError: true,
            }
          }
        },
      ),
      tool(
        'update_task',
        'Create or mutate a scheduled task. Always list tasks first to avoid duplicates.',
        {
          action: z.enum(['create', 'update', 'pause', 'resume', 'delete']).describe('Task write action'),
          name: z.string().min(1).describe('Task name used as stable identifier inside a chat'),
          chat_id: z.string().optional().describe('Optional chat id. Defaults to current chat'),
          prompt: z.string().optional().describe('Task prompt (required for create)'),
          description: z.string().optional().describe('Optional task description'),
          schedule_type: z.enum(['cron', 'interval', 'once']).optional().describe('Schedule type (required for create)'),
          schedule_value: z.string().optional().describe('Schedule value (required for create)'),
          timezone: z.string().nullable().optional().describe('IANA timezone for cron schedules'),
          delivery_mode: z.enum(['none', 'push']).optional().describe('Optional delivery mode'),
          delivery_target: z.string().nullable().optional().describe('Optional delivery target'),
        },
        async (args) => {
          const logger = getLogger()
          try {
            if (args.action === 'create') {
              const error = ensureCreateInput(args)
              if (error) {
                return { content: [{ type: 'text' as const, text: error }], isError: true }
              }
            }
            if (args.action === 'update') {
              const error = ensureUpdateInput(args)
              if (error) {
                return { content: [{ type: 'text' as const, text: error }], isError: true }
              }
            }

            const result = await service.applyTaskAction({
              agentId: context.agentId,
              chatId: args.chat_id ?? context.chatId,
              action: args.action as TaskWriteAction,
              name: args.name,
              prompt: args.prompt,
              description: args.description,
              scheduleType: args.schedule_type,
              scheduleValue: args.schedule_value,
              timezone: args.timezone,
              deliveryMode: args.delivery_mode,
              deliveryTarget: args.delivery_target,
            })

            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ action: args.action, result }, null, 2),
              }],
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const statusCode = err instanceof TaskServiceError ? err.statusCode : undefined
            logger.error(
              { error: msg, statusCode, action: args.action, taskName: args.name, agentId: context.agentId, chatId: context.chatId, category: 'task' },
              'update_task failed'
            )
            return {
              content: [{ type: 'text' as const, text: `Failed to update task: ${msg}` }],
              isError: true,
            }
          }
        },
      ),
    ],
  })
}
