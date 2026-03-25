import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import './setup.ts'
import { cleanTables } from './setup.ts'
import { getPaths } from '../src/config/index.ts'
import { updateSettings } from '../src/settings/manager.ts'
import { resolveRuntimeModelConfig, resolveRuntimeModelConfigByAgentId } from '../src/agent/runtime-model.ts'

const createdAgentIds = new Set<string>()

function createAgent(agentId: string, yaml: string) {
  const agentDir = resolve(getPaths().agents, agentId)
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(resolve(agentDir, 'agent.yaml'), yaml)
  createdAgentIds.add(agentId)
}

describe('runtime model resolution', () => {
  beforeEach(() => {
    cleanTables('kv_state')
  })

  afterEach(() => {
    for (const agentId of createdAgentIds) {
      rmSync(resolve(getPaths().agents, agentId), { recursive: true, force: true })
    }
    createdAgentIds.clear()
  })

  test('uses explicit agent model with builtin credentials when no custom model matches', () => {
    const result = resolveRuntimeModelConfig({ agentModel: 'minimax/MiniMax-M2.5-highspeed' })

    expect(result.error).toBeUndefined()
    expect(result.config).toMatchObject({
      provider: 'builtin',
      modelId: 'minimax/MiniMax-M2.5-highspeed',
      source: 'builtin',
    })
    expect(result.config?.apiKey.length).toBeGreaterThan(0)
  })

  test('prefers matching custom model credentials for explicit agent model', () => {
    updateSettings({
      activeModel: { provider: 'builtin' },
      customModels: [{
        id: 'openai-main',
        name: 'OpenAI Main',
        provider: 'openai',
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.example',
        modelId: 'gpt-4.1',
      }],
    })

    const result = resolveRuntimeModelConfig({ agentModel: 'openai/gpt-4.1' })

    expect(result.error).toBeUndefined()
    expect(result.config).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-4.1',
      apiKey: 'openai-key',
      baseUrl: 'https://api.openai.example',
      source: 'custom',
    })
  })

  test('reads agent.yaml model by agent id', () => {
    createAgent('runtime-model-agent', [
      'id: runtime-model-agent',
      'name: Runtime Model Agent',
      'model: openai/gpt-4.1',
      '',
    ].join('\n'))
    updateSettings({
      customModels: [{
        id: 'openai-main',
        name: 'OpenAI Main',
        provider: 'openai',
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.example',
        modelId: 'gpt-4.1',
      }],
      activeModel: { provider: 'custom', id: 'openai-main' },
    })

    const result = resolveRuntimeModelConfigByAgentId('runtime-model-agent')

    expect(result.error).toBeUndefined()
    expect(result.config?.provider).toBe('openai')
    expect(result.config?.modelId).toBe('gpt-4.1')
  })

  test('falls back to active settings model when agent.yaml does not explicitly set model', () => {
    createAgent('runtime-model-fallback-agent', [
      'id: runtime-model-fallback-agent',
      'name: Runtime Fallback Agent',
      '',
    ].join('\n'))
    updateSettings({
      customModels: [{
        id: 'openai-main',
        name: 'OpenAI Main',
        provider: 'openai',
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.example',
        modelId: 'gpt-4.1',
      }],
      activeModel: { provider: 'custom', id: 'openai-main' },
    })

    const result = resolveRuntimeModelConfigByAgentId('runtime-model-fallback-agent')

    expect(result.error).toBeUndefined()
    expect(result.config).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-4.1',
      apiKey: 'openai-key',
    })
  })

  test('treats model: default as inheriting the active settings model', () => {
    createAgent('runtime-model-default-agent', [
      'id: runtime-model-default-agent',
      'name: Runtime Default Agent',
      'model: default',
      '',
    ].join('\n'))
    updateSettings({
      customModels: [{
        id: 'openai-main',
        name: 'OpenAI Main',
        provider: 'openai',
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.example',
        modelId: 'gpt-4.1',
      }],
      activeModel: { provider: 'custom', id: 'openai-main' },
    })

    const result = resolveRuntimeModelConfigByAgentId('runtime-model-default-agent')

    expect(result.error).toBeUndefined()
    expect(result.config).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-4.1',
      apiKey: 'openai-key',
    })
  })
})
