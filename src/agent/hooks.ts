import { resolve } from 'node:path'
import { getLogger } from '../logger/index.ts'
import type { HooksConfig } from './schema.ts'

/**
 * Hook lifecycle phases
 */
export type HookPhase =
  | 'pre_process'       // Before message enters agent (can modify prompt, can reject)
  | 'post_process'      // After agent reply (can modify response text)
  | 'pre_tool_use'      // Before agent calls a tool (can intercept, can modify params)
  | 'post_tool_use'     // After tool execution (can modify result)
  | 'pre_compact'       // Before session compact (can archive full conversation)
  | 'on_error'          // When an error occurs
  | 'on_session_start'  // When a new session is created
  | 'on_session_end'    // When a session ends

/**
 * Hook context: data passed to hook scripts
 */
export interface HookContext {
  agentId: string
  chatId: string
  phase: HookPhase
  payload: Record<string, unknown>
  modifiedPayload?: Record<string, unknown>
  abort?: boolean
  abortReason?: string
}

/**
 * Hook handler function signature
 */
export type HookHandler = (ctx: HookContext) => Promise<HookContext>

/**
 * Internal hook entry (includes loaded function reference)
 */
interface LoadedHook {
  handler: HookHandler
  priority: number
  tools?: string[]     // pre_tool_use only: applies to specified tools only
  source: string       // Script path or 'builtin'
}

const HOOK_TIMEOUT_MS = 5000

/**
 * HooksManager: manages Agent lifecycle hooks
 *
 * Features:
 * - Load .ts scripts from agent.yaml hooks config
 * - Built-in hook registration (e.g. security policies)
 * - Execute in priority order (ascending)
 * - 5-second timeout protection
 * - Error isolation (hook errors do not affect main flow)
 */
export class HooksManager {
  // agentId -> phase -> LoadedHook[]
  private hooks: Map<string, Map<HookPhase, LoadedHook[]>> = new Map()

  /**
   * Load agent hooks config, dynamically import() scripts
   */
  async loadHooks(agentId: string, workspaceDir: string, hooksConfig: HooksConfig): Promise<void> {
    const logger = getLogger()
    const phases: HookPhase[] = [
      'pre_process', 'post_process', 'pre_tool_use', 'post_tool_use',
      'pre_compact', 'on_error', 'on_session_start', 'on_session_end',
    ]

    for (const phase of phases) {
      const entries = hooksConfig[phase]
      if (!entries || entries.length === 0) continue

      for (const entry of entries) {
        const scriptPath = resolve(workspaceDir, entry.script)

        try {
          const module = await import(scriptPath)
          const handler: HookHandler = module.default ?? module

          if (typeof handler !== 'function') {
            logger.warn({ agentId, script: entry.script }, 'Hook script does not export a function, skipping')
            continue
          }

          this.registerHook(agentId, phase, {
            handler,
            priority: entry.priority ?? 0,
            tools: entry.tools,
            source: scriptPath,
          })

          logger.info({ agentId, phase, script: entry.script }, 'Hook loaded')
        } catch (err) {
          logger.error({
            agentId,
            phase,
            script: entry.script,
            error: err instanceof Error ? err.message : String(err),
          }, 'Failed to load hook script')
        }
      }
    }
  }

  /**
   * Register a built-in hook (e.g. security policy)
   */
  registerBuiltinHook(agentId: string, phase: HookPhase, handler: HookHandler, priority: number = 0): void {
    this.registerHook(agentId, phase, {
      handler,
      priority,
      source: 'builtin',
    })
  }

  /**
   * Execute hook chain (ascending priority; lower value runs first; supports early abort)
   */
  async execute(agentId: string, phase: HookPhase, ctx: HookContext): Promise<HookContext> {
    const logger = getLogger()
    const agentHooks = this.hooks.get(agentId)
    if (!agentHooks) return ctx

    const phaseHooks = agentHooks.get(phase)
    if (!phaseHooks || phaseHooks.length === 0) return ctx

    let currentCtx = { ...ctx }

    for (const hook of phaseHooks) {
      // Filter by tools for pre_tool_use phase
      if (phase === 'pre_tool_use' && hook.tools && hook.tools.length > 0) {
        const tool = currentCtx.payload.tool as string
        if (!hook.tools.includes(tool)) {
          continue
        }
      }

      try {
        currentCtx = await this.executeWithTimeout(hook.handler, currentCtx, HOOK_TIMEOUT_MS)
      } catch (err) {
        logger.error({
          agentId,
          phase,
          source: hook.source,
          error: err instanceof Error ? err.message : String(err),
        }, 'Hook execution failed (skipped)')
        // Hook errors do not affect main flow
        continue
      }

      // Check abort flag
      if (currentCtx.abort) {
        logger.info({
          agentId,
          phase,
          source: hook.source,
          reason: currentCtx.abortReason,
        }, 'Hook triggered abort')
        break
      }
    }

    return currentCtx
  }

  /**
   * Clear hooks for a given agent (used during reload)
   */
  unloadHooks(agentId: string): void {
    this.hooks.delete(agentId)
  }

  /**
   * Register a hook to internal storage
   */
  private registerHook(agentId: string, phase: HookPhase, hook: LoadedHook): void {
    if (!this.hooks.has(agentId)) {
      this.hooks.set(agentId, new Map())
    }

    const agentHooks = this.hooks.get(agentId)!
    if (!agentHooks.has(phase)) {
      agentHooks.set(phase, [])
    }

    const phaseHooks = agentHooks.get(phase)!
    phaseHooks.push(hook)

    // Sort by priority ascending (lower value = higher priority, runs first)
    phaseHooks.sort((a, b) => a.priority - b.priority)
  }

  /**
   * Execute hook with timeout
   */
  private executeWithTimeout(handler: HookHandler, ctx: HookContext, timeoutMs: number): Promise<HookContext> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Hook execution timed out (${timeoutMs}ms)`))
      }, timeoutMs)

      handler(ctx)
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((err) => {
          clearTimeout(timer)
          reject(err)
        })
    })
  }
}
