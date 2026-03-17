import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { getBrowserProfile } from '../db/index.ts'
import type { SkillsLoader } from '../skills/index.ts'
import type { MemoryManager } from '../memory/index.ts'
import type { AgentConfig } from './types.ts'

// Workspace MD file loading order
const WORKSPACE_FILES = ['SOUL.md', 'USER.md', 'AGENT.md', 'TOOLS.md'] as const

export class PromptBuilder {
  constructor(
    private skillsLoader: SkillsLoader | null,
    private memoryManager: MemoryManager | null,
  ) {}

  /**
   * Build the complete system prompt
   * Loading order: SOUL.md -> USER.md -> AGENT.md -> TOOLS.md -> Memory -> Env
   */
  build(
    workspaceDir: string,
    config: AgentConfig,
    context?: { agentId: string; chatId: string; requestedSkills?: string[]; browserProfileId?: string },
  ): string {
    const parts: string[] = []

    // Memory file absolute paths
    const agentMemoryDir = resolve(workspaceDir, 'memory')
    const agentMemoryPath = resolve(agentMemoryDir, 'MEMORY.md')
    const globalMemoryPath = resolve(getPaths().agents, '_global', 'memory', 'MEMORY.md')

    // IPC absolute paths (agent writes here, IPC Watcher reads from here)
    const agentId = context?.agentId ?? 'default'
    const ipcTasksDir = resolve(getPaths().data, 'ipc', agentId, 'tasks')
    const ipcCurrentTasksPath = resolve(getPaths().data, 'ipc', agentId, 'current_tasks.json')

    // Load workspace MD files in order
    for (const filename of WORKSPACE_FILES) {
      let content = this.loadMdFile(workspaceDir, filename)
      if (content) {
        // Replace memory path placeholders with absolute paths
        content = content
          .replaceAll('{{agentMemoryDir}}', agentMemoryDir)
          .replaceAll('{{agentMemoryPath}}', agentMemoryPath)
          .replaceAll('{{globalMemoryPath}}', globalMemoryPath)
          .replaceAll('{{ipcTasksDir}}', ipcTasksDir)
          .replaceAll('{{ipcCurrentTasksPath}}', ipcCurrentTasksPath)
        parts.push(content)
      }
    }

    // If workspace has no MD files, fall back to global system.md
    if (parts.length === 0) {
      const fallback = this.loadGlobalSystemPrompt()
      if (fallback) {
        parts.push(fallback)
      }
    }

    // Inject browser profile context
    const browserCtx = this.buildBrowserProfileContext(config, context?.browserProfileId)
    if (browserCtx) {
      parts.push(browserCtx)
    }

    // Inject memory context
    if (this.memoryManager && context) {
      const memoryConfig = config.memory
      const memoryContext = this.memoryManager.getMemoryContext(context.agentId, {
        recentDays: memoryConfig?.recentDays,
        maxContextChars: memoryConfig?.maxContextChars,
      })
      if (memoryContext) {
        parts.push(memoryContext)
      }
    }

    // Inject environment context
    const envContext = this.buildEnvContext()
    if (envContext) {
      parts.push(envContext)
    }

    // Inject current context (needed when agent creates scheduled tasks)
    if (context) {
      parts.push(
        `\n## Current Context\n- Agent ID: ${context.agentId}\n- Chat ID: ${context.chatId}\n- IPC Directory: ${ipcTasksDir}`,
      )
    }

    return parts.join('\n\n')
  }

  /**
   * Load workspace MD file, skip if missing (no error)
   */
  private loadMdFile(workspaceDir: string, filename: string): string | null {
    const filePath = resolve(workspaceDir, filename)

    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8').trim()
        if (content) {
          getLogger().debug({ filename, source: 'workspace' }, 'Prompt file loaded')
          return content
        }
      } catch (err) {
        getLogger().warn({ filename, error: err instanceof Error ? err.message : String(err) }, 'Failed to read prompt file')
      }
    }

    return null
  }

  /**
   * Fall back to global prompts/system.md
   */
  private loadGlobalSystemPrompt(): string | null {
    const systemPath = resolve(getPaths().prompts, 'system.md')
    if (existsSync(systemPath)) {
      try {
        return readFileSync(systemPath, 'utf-8').trim()
      } catch {
        return null
      }
    }
    return null
  }

  /**
   * Build environment context (dynamically generated from prompts/env.md template)
   */
  private buildEnvContext(): string | null {
    const envPath = resolve(getPaths().prompts, 'env.md')
    if (!existsSync(envPath)) return null

    try {
      let envPrompt = readFileSync(envPath, 'utf-8')
      envPrompt = envPrompt
        .replace('{{date}}', new Date().toISOString().split('T')[0]!)
        .replace('{{os}}', process.platform)
        .replace('{{platform}}', process.arch)
        .replace('{{cwd}}', process.cwd())
      return envPrompt.trim()
    } catch {
      return null
    }
  }

  /**
   * Build browser profile context
   */
  private buildBrowserProfileContext(config: AgentConfig, overrideBrowserProfileId?: string): string | null {
    const profileId = overrideBrowserProfileId ?? config.browserProfile
    if (!profileId) return null
    const profile = getBrowserProfile(profileId)
    if (!profile) return null
    const profileDir = resolve(getPaths().browserProfiles, profile.id)
    return `## Browser Profile\n\nWhen using agent-browser, ALWAYS include \`--headed --profile ${profileDir}\` to use the persistent browser profile "${profile.name}" in headed mode (visible browser window). Example:\n\n\`\`\`bash\nagent-browser --headed --profile ${profileDir} open https://example.com\n\`\`\``
  }

}
