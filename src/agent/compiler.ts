import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { AgentConfigSchema } from './schema.ts'
import { resolveMcpServers } from './mcp-utils.ts'
import type { PromptBuilder } from './prompt-builder.ts'
import type { AgentEntry, AgentRef, AgentDefinition } from './schema.ts'

// SDK 期望的子 Agent 定义格式
interface SDKAgentDefinition {
  description: string
  prompt?: string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  maxTurns?: number
  mcpServers?: Record<string, unknown>
}

/**
 * AgentCompiler：将 agent.yaml 中的 ref 引用编译为 SDK 期望的扁平 AgentDefinition
 *
 * 支持两种子 Agent 定义方式：
 * 1. 内联定义（原有方式）：直接写 description + prompt + tools
 * 2. ref 引用（新增）：通过 ref 字段引用顶层 agent 的完整配置
 */
export class AgentCompiler {
  constructor(private promptBuilder: PromptBuilder) {}

  /**
   * 解析 agents 字段中的所有 entry，编译为 SDK AgentDefinition
   */
  resolve(
    agents: Record<string, AgentEntry>,
    parentAgentId: string,
  ): Record<string, SDKAgentDefinition> {
    const result: Record<string, SDKAgentDefinition> = {}
    const resolving = new Set<string>([parentAgentId])

    for (const [name, entry] of Object.entries(agents)) {
      if (this.isRefEntry(entry)) {
        result[name] = this.compileRef(entry as AgentRef, resolving)
      } else {
        // 内联定义，直接传递
        result[name] = entry as SDKAgentDefinition
      }
    }

    return result
  }

  /**
   * 判断 entry 是否为 ref 引用
   */
  private isRefEntry(entry: AgentEntry): entry is AgentRef {
    return 'ref' in entry && typeof (entry as AgentRef).ref === 'string'
  }

  /**
   * 编译单个 ref 引用为 SDK AgentDefinition
   */
  private compileRef(ref: AgentRef, resolving: Set<string>): SDKAgentDefinition {
    const logger = getLogger()
    const targetId = ref.ref

    // 循环检测
    if (resolving.has(targetId)) {
      const chain = [...resolving, targetId].join(' → ')
      throw new Error(`检测到循环引用: ${chain}`)
    }
    resolving.add(targetId)

    try {
      // 加载目标 agent.yaml
      const paths = getPaths()
      const agentDir = resolve(paths.agents, targetId)
      const configPath = resolve(agentDir, 'agent.yaml')

      if (!existsSync(configPath)) {
        throw new Error(`ref 引用的 agent "${targetId}" 不存在: ${configPath}`)
      }

      const rawYaml = readFileSync(configPath, 'utf-8')
      const parsed = parseYaml(rawYaml) as Record<string, unknown>

      const result = AgentConfigSchema.safeParse({
        ...parsed,
        id: parsed.id ?? targetId,
        name: parsed.name ?? targetId,
      })

      if (!result.success) {
        throw new Error(`ref 引用的 agent "${targetId}" 配置校验失败: ${JSON.stringify(result.error.issues)}`)
      }

      const targetConfig = result.data

      // 使用 PromptBuilder 编译 prompt
      const systemPrompt = this.promptBuilder.build(agentDir, {
        ...targetConfig,
        workspaceDir: agentDir,
      })

      // 构建 SDK AgentDefinition
      const definition: SDKAgentDefinition = {
        description: ref.description ?? targetConfig.name,
      }

      // 编译 prompt：目标 agent 的完整 system prompt + ref 追加的 prompt
      let finalPrompt = systemPrompt
      if (ref.prompt) {
        finalPrompt += '\n\n' + ref.prompt
      }
      if (finalPrompt) {
        definition.prompt = finalPrompt
      }

      // 工具配置：ref 覆盖 > 目标配置
      if (ref.tools) {
        definition.tools = ref.tools
      } else if (targetConfig.allowedTools) {
        definition.tools = targetConfig.allowedTools
      }

      if (ref.disallowedTools) {
        definition.disallowedTools = ref.disallowedTools
      } else if (targetConfig.disallowedTools) {
        definition.disallowedTools = targetConfig.disallowedTools
      }

      // model: ref 覆盖 > 目标配置
      if (ref.model) {
        definition.model = ref.model
      } else if (targetConfig.model) {
        definition.model = targetConfig.model
      }

      // maxTurns: ref 覆盖 > 目标配置
      if (ref.maxTurns) {
        definition.maxTurns = ref.maxTurns
      } else if (targetConfig.maxTurns) {
        definition.maxTurns = targetConfig.maxTurns
      }

      // MCP 服务器
      if (targetConfig.mcpServers) {
        definition.mcpServers = resolveMcpServers(targetConfig.mcpServers)
      }

      // 递归解析目标 agent 的子 agents
      if (targetConfig.agents) {
        const nestedAgents = this.resolve(targetConfig.agents, targetId)
        // SDK 不支持嵌套 agents 定义，这里只记录日志
        if (Object.keys(nestedAgents).length > 0) {
          logger.debug({ targetId, nestedCount: Object.keys(nestedAgents).length }, 'ref 引用的 agent 包含子 agents（忽略嵌套）')
        }
      }

      logger.info({ targetId, hasPrompt: !!definition.prompt, hasTools: !!definition.tools }, 'ref 引用编译完成')
      return definition
    } finally {
      resolving.delete(targetId)
    }
  }
}
