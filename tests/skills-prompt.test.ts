import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import './setup.ts'
import { getPaths } from '../src/config/index.ts'
import { SkillsLoader } from '../src/skills/loader.ts'
import type { AgentConfig } from '../src/agent/types.ts'

const createdAgentIds = new Set<string>()

function createAgentSkill(agentId: string, skillName: string, body: string) {
  const skillDir = resolve(getPaths().agents, agentId, 'skills', skillName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(resolve(skillDir, 'SKILL.md'), body)
  createdAgentIds.add(agentId)
}

describe('SkillsLoader.buildPromptSnapshot', () => {
  beforeEach(() => {
    for (const agentId of createdAgentIds) {
      rmSync(resolve(getPaths().agents, agentId), { recursive: true, force: true })
    }
    createdAgentIds.clear()
  })

  afterEach(() => {
    for (const agentId of createdAgentIds) {
      rmSync(resolve(getPaths().agents, agentId), { recursive: true, force: true })
    }
    createdAgentIds.clear()
  })

  test('injects only requested usable skills into the prompt snapshot', () => {
    createAgentSkill('skills-prompt-agent', 'alpha-skill', [
      '---',
      'name: alpha-skill',
      'description: Alpha skill',
      '---',
      'Use alpha workflow.',
      '',
    ].join('\n'))
    createAgentSkill('skills-prompt-agent', 'beta-skill', [
      '---',
      'name: beta-skill',
      'description: Beta skill',
      '---',
      'Use beta workflow.',
      '',
    ].join('\n'))

    const loader = new SkillsLoader()
    loader.refresh()
    const agentConfig = {
      id: 'skills-prompt-agent',
      name: 'Skills Agent',
      workspaceDir: resolve(getPaths().agents, 'skills-prompt-agent'),
      skills: ['alpha-skill', 'beta-skill'],
    } as AgentConfig

    const snapshot = loader.buildPromptSnapshot(agentConfig, ['beta-skill'])

    expect(snapshot.skills.map((skill) => skill.name)).toEqual(['beta-skill'])
    expect(snapshot.prompt).toContain('beta-skill')
    expect(snapshot.prompt).not.toContain('alpha-skill')
  })
})
