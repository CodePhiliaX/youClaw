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

  test('inline definition is passed through directly', () => {
    const agents = {
      translator: {
        description: 'Translation assistant',
        prompt: 'You are a translator',
        tools: ['Read', 'Write'],
      },
    }

    const result = compiler.resolve(agents, 'parent')

    expect(result.translator).toBeDefined()
    expect(result.translator!.description).toBe('Translation assistant')
    expect(result.translator!.prompt).toBe('You are a translator')
    expect(result.translator!.tools).toEqual(['Read', 'Write'])
  })

  test('ref reference compiles to SDK AgentDefinition', () => {
    const targetId = createAgentId('target')
    createAgentOnDisk(targetId, {
      model: 'claude-sonnet-4-6',
      allowedTools: ['Read', 'Grep'],
    }, '# You are a research assistant\n\nPlease carefully review the materials.')

    const agents = {
      researcher: {
        ref: targetId,
        description: 'Help me research',
      },
    }

    const result = compiler.resolve(agents, 'parent')

    expect(result.researcher).toBeDefined()
    expect(result.researcher!.description).toBe('Help me research')
    expect(result.researcher!.prompt).toContain('You are a research assistant')
    expect(result.researcher!.tools).toEqual(['Read', 'Grep'])
    expect(result.researcher!.model).toBe('claude-sonnet-4-6')
  })

  test('ref override fields take priority over target config', () => {
    const targetId = createAgentId('target-override')
    createAgentOnDisk(targetId, {
      model: 'claude-sonnet-4-6',
      allowedTools: ['Read'],
      maxTurns: 10,
    })

    const agents = {
      custom: {
        ref: targetId,
        description: 'Custom description',
        model: 'claude-opus-4-6',
        tools: ['Read', 'Write', 'Bash'],
        maxTurns: 30,
      },
    }

    const result = compiler.resolve(agents, 'parent')

    expect(result.custom!.description).toBe('Custom description')
    expect(result.custom!.model).toBe('claude-opus-4-6')
    expect(result.custom!.tools).toEqual(['Read', 'Write', 'Bash'])
    expect(result.custom!.maxTurns).toBe(30)
  })

  test('ref prompt is appended to target prompt', () => {
    const targetId = createAgentId('target-prompt')
    createAgentOnDisk(targetId, {}, '# Base prompt')

    const agents = {
      extended: {
        ref: targetId,
        description: 'Extended assistant',
        prompt: 'Additional instruction: please respond in Chinese',
      },
    }

    const result = compiler.resolve(agents, 'parent')

    expect(result.extended!.prompt).toContain('Base prompt')
    expect(result.extended!.prompt).toContain('Additional instruction: please respond in Chinese')
    // appended prompt comes after base prompt
    const baseIdx = result.extended!.prompt!.indexOf('Base prompt')
    const extIdx = result.extended!.prompt!.indexOf('Additional instruction')
    expect(extIdx).toBeGreaterThan(baseIdx)
  })

  test('throws error when ref references a non-existent agent', () => {
    const agents = {
      missing: {
        ref: 'nonexistent-agent-id',
        description: 'Non-existent agent',
      },
    }

    expect(() => compiler.resolve(agents, 'parent')).toThrow()
  })

  test('circular reference detection', () => {
    // create A -> B reference
    const agentA = createAgentId('cycle-a')
    const agentB = createAgentId('cycle-b')

    createAgentOnDisk(agentA, {
      agents: { b: { ref: agentB, description: 'B' } },
    })
    createAgentOnDisk(agentB, {
      agents: { a: { ref: agentA, description: 'A' } },
    })

    // A's agents reference B, and parent is A -> should not directly cycle
    // But if we manually construct parent=agentA, ref=agentA, it cycles
    const agents = {
      self: {
        ref: agentA,
        description: 'Self-reference',
      },
    }

    // parent is agentA, ref is also agentA -> cycle
    expect(() => compiler.resolve(agents, agentA)).toThrow()
  })

  test('disallowedTools inherited from target config', () => {
    const targetId = createAgentId('target-disallowed')
    createAgentOnDisk(targetId, {
      disallowedTools: ['Bash', 'Write'],
    })

    const agents = {
      safe: {
        ref: targetId,
        description: 'Safe assistant',
      },
    }

    const result = compiler.resolve(agents, 'parent')
    expect(result.safe!.disallowedTools).toEqual(['Bash', 'Write'])
  })

  test('ref disallowedTools overrides target config', () => {
    const targetId = createAgentId('target-override-disallowed')
    createAgentOnDisk(targetId, {
      disallowedTools: ['Bash'],
    })

    const agents = {
      custom: {
        ref: targetId,
        description: 'Custom',
        disallowedTools: ['Write'],
      },
    }

    const result = compiler.resolve(agents, 'parent')
    expect(result.custom!.disallowedTools).toEqual(['Write'])
  })

  test('mixed inline and ref definitions', () => {
    const targetId = createAgentId('target-mixed')
    createAgentOnDisk(targetId, {}, '# Research Agent')

    const agents = {
      researcher: {
        ref: targetId,
        description: 'Research assistant',
      },
      translator: {
        description: 'Translation assistant',
        prompt: 'Translate text',
      },
    }

    const result = compiler.resolve(agents, 'parent')

    expect(result.researcher!.prompt).toContain('Research Agent')
    expect(result.translator!.description).toBe('Translation assistant')
    expect(result.translator!.prompt).toBe('Translate text')
  })
})
