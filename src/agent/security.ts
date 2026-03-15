import { resolve, isAbsolute } from 'node:path'
import type { SecurityConfig } from './schema.ts'
import type { HookHandler, HookContext } from './hooks.ts'

/**
 * Create security policy hook
 *
 * Registered as highest-priority pre_tool_use hook (priority = -1000),
 * executes before all user hooks
 *
 * Supports:
 * - Tool allowlist/denylist
 * - File path access control (allowedPaths / deniedPaths)
 */
export function createSecurityHook(securityConfig: SecurityConfig): HookHandler {
  const allowedTools = securityConfig.allowedTools
    ? new Set(securityConfig.allowedTools)
    : null
  const disallowedTools = securityConfig.disallowedTools
    ? new Set(securityConfig.disallowedTools)
    : null

  const allowedPaths = securityConfig.fileAccess?.allowedPaths
  const deniedPaths = securityConfig.fileAccess?.deniedPaths

  return async (ctx: HookContext): Promise<HookContext> => {
    const tool = ctx.payload.tool as string

    // Check tool allowlist
    if (allowedTools && !allowedTools.has(tool)) {
      ctx.abort = true
      ctx.abortReason = `Tool "${tool}" is not in the allowed list`
      return ctx
    }

    // Check tool denylist
    if (disallowedTools && disallowedTools.has(tool)) {
      ctx.abort = true
      ctx.abortReason = `Tool "${tool}" is blocked`
      return ctx
    }

    // Check file path access (applies to file operation tools)
    const fileTools = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep'])
    if (fileTools.has(tool) && (allowedPaths || deniedPaths)) {
      const input = ctx.payload.input as Record<string, unknown> | undefined
      const filePath = extractFilePath(tool, input)

      if (filePath) {
        const normalizedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)

        // Check deniedPaths
        if (deniedPaths) {
          for (const denied of deniedPaths) {
            const normalizedDenied = isAbsolute(denied) ? denied : resolve(process.cwd(), denied)
            if (normalizedPath.startsWith(normalizedDenied)) {
              ctx.abort = true
              ctx.abortReason = `File path "${filePath}" is in the denied list`
              return ctx
            }
          }
        }

        // Check allowedPaths
        if (allowedPaths && allowedPaths.length > 0) {
          const allowed = allowedPaths.some((ap) => {
            const normalizedAllowed = isAbsolute(ap) ? ap : resolve(process.cwd(), ap)
            return normalizedPath.startsWith(normalizedAllowed)
          })
          if (!allowed) {
            ctx.abort = true
            ctx.abortReason = `File path "${filePath}" is not in the allowed list`
            return ctx
          }
        }
      }
    }

    return ctx
  }
}

/**
 * Extract file path from tool input
 */
function extractFilePath(tool: string, input: Record<string, unknown> | undefined): string | null {
  if (!input) return null

  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return (input.file_path ?? input.path) as string | null
    case 'Glob':
    case 'Grep':
      return (input.path ?? input.directory) as string | null
    default:
      return null
  }
}
