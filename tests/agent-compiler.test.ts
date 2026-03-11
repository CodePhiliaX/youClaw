import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import './setup-light.ts'
import { getPaths } from '../src/config/index.ts'
import { AgentCompiler } from '../src/agent/compiler.ts'
import { PromptBuilder } from '../src/agent/prompt-builder.ts'

const createdAgentIds = new Set<string>()

function createAgentId(prefix: string) {
  const agentId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  createdAgentIds.add(agentId)
  return agentId
}

function getAgentDir(agentId: string) {
  return resolve(getPaths().agents, agentId)
}

function createAgentOnDisk(
  agentId: string,
  config: Record<string, unknown>,
  soulMd?: string,
) {
  const dir = getAgentDir(agentId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'agent.yaml'), stringifyYaml({
    id: agentId,
    name: `Agent ${agentId}`,
    ...config,
  }))
  if (soulMd) {
    writeFileSync(resolve(dir, 'SOUL.md'), soulMd)
  }
}

describe('AgentCompiler', () => {
  let compiler: AgentCompiler

  beforeEach(() => {
    for (const id of createdAgentIds) {
      rmSync(getAgentDir(id), { recursive: true, force: true })
    }
    createdAgentIds.clear()
    compiler = new AgentCompiler(new PromptBuilder(null, null))
  })

  afterEach(() => {
    for (const id of createdAgentIds) {
      rmSync(getAgentDir(id), { recursive: true, force: true })
    }
    createdAgentIds.clear()
  })

  test('内联定义直接透传', () => {
    const agents = {
      translator: {
        description: '翻译助手',
        prompt: 'You are a translator',
        tools: ['Read', 'Write'],
      },
    }

    const result = compiler.resolve(agents, 'parent')

    expect(result.translator).toBeDefined()
    expect(result.translator!.description).toBe('翻译助手')
    expect(result.translator!.prompt).toBe('You are a translator')
    expect(result.translator!.tools).toEqual(['Read', 'Write'])
  })

  test('ref 引用编译为 SDK AgentDefinition', () => {
    const targetId = createAgentId('target')
    createAgentOnDisk(targetId, {
      model: 'claude-sonnet-4-6',
      allowedTools: ['Read', 'Grep'],
    }, '# 你是一个研究助手\n\n请认真查阅资料。')

    const agents = {
      researcher: {
        ref: targetId,
        description: '帮我查资料',
      },
    }

    const result = compiler.resolve(agents, 'parent')

    expect(result.researcher).toBeDefined()
    expect(result.researcher!.description).toBe('帮我查资料')
    expect(result.researcher!.prompt).toContain('你是一个研究助手')
    expect(result.researcher!.tools).toEqual(['Read', 'Grep'])
    expect(result.researcher!.model).toBe('claude-sonnet-4-6')
  })

  test('ref 覆盖字段优先于目标配置', () => {
    const targetId = createAgentId('target-override')
    createAgentOnDisk(targetId, {
      model: 'claude-sonnet-4-6',
      allowedTools: ['Read'],
      maxTurns: 10,
    })

    const agents = {
      custom: {
        ref: targetId,
        description: '自定义描述',
        model: 'claude-opus-4-6',
        tools: ['Read', 'Write', 'Bash'],
        maxTurns: 30,
      },
    }

    const result = compiler.resolve(agents, 'parent')

    expect(result.custom!.description).toBe('自定义描述')
    expect(result.custom!.model).toBe('claude-opus-4-6')
    expect(result.custom!.tools).toEqual(['Read', 'Write', 'Bash'])
    expect(result.custom!.maxTurns).toBe(30)
  })

  test('ref 的 prompt 追加到目标 prompt 末尾', () => {
    const targetId = createAgentId('target-prompt')
    createAgentOnDisk(targetId, {}, '# Base prompt')

    const agents = {
      extended: {
        ref: targetId,
        description: '扩展助手',
        prompt: '额外指令：请用中文回答',
      },
    }

    const result = compiler.resolve(agents, 'parent')

    expect(result.extended!.prompt).toContain('Base prompt')
    expect(result.extended!.prompt).toContain('额外指令：请用中文回答')
    // 追加的 prompt 在基础 prompt 之后
    const baseIdx = result.extended!.prompt!.indexOf('Base prompt')
    const extIdx = result.extended!.prompt!.indexOf('额外指令')
    expect(extIdx).toBeGreaterThan(baseIdx)
  })

  test('ref 引用不存在的 agent 时抛出错误', () => {
    const agents = {
      missing: {
        ref: 'nonexistent-agent-id',
        description: '不存在的 agent',
      },
    }

    expect(() => compiler.resolve(agents, 'parent')).toThrow(/不存在/)
  })

  test('循环引用检测', () => {
    // 创建 A → B 引用
    const agentA = createAgentId('cycle-a')
    const agentB = createAgentId('cycle-b')

    createAgentOnDisk(agentA, {
      agents: { b: { ref: agentB, description: 'B' } },
    })
    createAgentOnDisk(agentB, {
      agents: { a: { ref: agentA, description: 'A' } },
    })

    // A 的 agents 中引用 B，而 parent 是 A → 不应该直接循环
    // 但如果我们手动构建 parent=agentA, ref=agentA，则循环
    const agents = {
      self: {
        ref: agentA,
        description: '自引用',
      },
    }

    // parent 是 agentA，ref 也是 agentA → 循环
    expect(() => compiler.resolve(agents, agentA)).toThrow(/循环引用/)
  })

  test('disallowedTools 从目标配置继承', () => {
    const targetId = createAgentId('target-disallowed')
    createAgentOnDisk(targetId, {
      disallowedTools: ['Bash', 'Write'],
    })

    const agents = {
      safe: {
        ref: targetId,
        description: '安全助手',
      },
    }

    const result = compiler.resolve(agents, 'parent')
    expect(result.safe!.disallowedTools).toEqual(['Bash', 'Write'])
  })

  test('ref 的 disallowedTools 覆盖目标配置', () => {
    const targetId = createAgentId('target-override-disallowed')
    createAgentOnDisk(targetId, {
      disallowedTools: ['Bash'],
    })

    const agents = {
      custom: {
        ref: targetId,
        description: '自定义',
        disallowedTools: ['Write'],
      },
    }

    const result = compiler.resolve(agents, 'parent')
    expect(result.custom!.disallowedTools).toEqual(['Write'])
  })

  test('混合内联和 ref 定义', () => {
    const targetId = createAgentId('target-mixed')
    createAgentOnDisk(targetId, {}, '# Research Agent')

    const agents = {
      researcher: {
        ref: targetId,
        description: '研究助手',
      },
      translator: {
        description: '翻译助手',
        prompt: 'Translate text',
      },
    }

    const result = compiler.resolve(agents, 'parent')

    expect(result.researcher!.prompt).toContain('Research Agent')
    expect(result.translator!.description).toBe('翻译助手')
    expect(result.translator!.prompt).toBe('Translate text')
  })
})
