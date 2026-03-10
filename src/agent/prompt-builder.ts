import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import type { SkillsLoader } from '../skills/index.ts'
import type { MemoryManager } from '../memory/index.ts'
import type { AgentConfig } from './types.ts'

// 工作空间 MD 文件加载顺序
const WORKSPACE_FILES = ['SOUL.md', 'USER.md', 'AGENT.md', 'TOOLS.md'] as const

export class PromptBuilder {
  constructor(
    private skillsLoader: SkillsLoader | null,
    private memoryManager: MemoryManager | null,
  ) {}

  /**
   * 构建完整的系统提示词
   * 加载顺序：SOUL.md → USER.md → AGENT.md → TOOLS.md → Skills → Memory → Env
   */
  build(
    workspaceDir: string,
    config: AgentConfig,
    context?: { agentId: string; chatId: string },
  ): string {
    const parts: string[] = []

    // 按顺序加载工作空间 MD 文件
    for (const filename of WORKSPACE_FILES) {
      const content = this.loadMdFile(workspaceDir, filename)
      if (content) {
        parts.push(content)
      }
    }

    // 如果工作空间没有任何 MD 文件，回退到全局 system.md
    if (parts.length === 0) {
      const fallback = this.loadGlobalSystemPrompt()
      if (fallback) {
        parts.push(fallback)
      }
    }

    // 注入 skills
    const skillsPrompt = this.buildSkillsPrompt(config)
    if (skillsPrompt) {
      parts.push(skillsPrompt)
    }

    // 注入记忆上下文
    if (this.memoryManager && context) {
      const memoryContext = this.memoryManager.getMemoryContext(context.agentId)
      if (memoryContext) {
        parts.push(memoryContext)
      }
    }

    // 注入环境上下文
    const envContext = this.buildEnvContext()
    if (envContext) {
      parts.push(envContext)
    }

    // 注入当前上下文（Agent 创建定时任务时需要）
    if (context) {
      parts.push(
        `\n## Current Context\n- Agent ID: ${context.agentId}\n- Chat ID: ${context.chatId}\n- IPC Directory: ./data/ipc/${context.agentId}/tasks/`,
      )
    }

    return parts.join('\n\n')
  }

  /**
   * 加载工作空间 MD 文件，缺失则跳过（不报错）
   */
  private loadMdFile(workspaceDir: string, filename: string): string | null {
    const filePath = resolve(workspaceDir, filename)

    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8').trim()
        if (content) {
          getLogger().debug({ filename, source: 'workspace' }, '加载提示词文件')
          return content
        }
      } catch (err) {
        getLogger().warn({ filename, error: err instanceof Error ? err.message : String(err) }, '读取提示词文件失败')
      }
    }

    return null
  }

  /**
   * 回退加载全局 prompts/system.md
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
   * 构建环境上下文（从 prompts/env.md 模板动态生成）
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
   * 构建 skills 提示词片段
   */
  private buildSkillsPrompt(config: AgentConfig): string | null {
    if (!this.skillsLoader) return null

    const skills = this.skillsLoader.loadSkillsForAgent(config)
    const eligibleSkills = skills.filter((s) => s.eligible)

    if (eligibleSkills.length === 0) return null

    const limited = this.skillsLoader.applyPromptLimits(eligibleSkills)

    let prompt = '## Skills\n'
    for (const skill of limited) {
      prompt += `\n### ${skill.name}\n${skill.content}\n`
    }

    return prompt
  }
}
