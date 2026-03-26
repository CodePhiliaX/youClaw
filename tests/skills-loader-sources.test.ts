import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import './setup.ts'
import { resetPathsCache } from '../src/config/index.ts'
import { SkillsLoader, resetSkillsSnapshotVersion } from '../src/skills/index.ts'
import type { AgentConfig } from '../src/agent/types.ts'

const originalEnv = {
  DATA_DIR: process.env.DATA_DIR,
  WORKSPACE_DIR: process.env.WORKSPACE_DIR,
  RESOURCES_DIR: process.env.RESOURCES_DIR,
}

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeSkill(rootDir: string, skillName: string, description: string, body: string): void {
  const skillDir = resolve(rootDir, skillName)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(resolve(skillDir, 'SKILL.md'), [
    '---',
    `name: ${skillName}`,
    `description: ${description}`,
    '---',
    body,
    '',
  ].join('\n'))
}

function createAgentConfig(agentId: string, workspaceRoot: string, skills?: string[]): AgentConfig {
  return {
    id: agentId,
    name: agentId,
    model: 'claude-sonnet-4-6',
    workspaceDir: resolve(workspaceRoot, 'agents', agentId),
    ...(skills ? { skills } : {}),
  } as AgentConfig
}

describe('SkillsLoader source precedence', () => {
  beforeEach(() => {
    resetPathsCache()
    resetSkillsSnapshotVersion()
  })

  afterEach(() => {
    process.env.DATA_DIR = originalEnv.DATA_DIR
    process.env.WORKSPACE_DIR = originalEnv.WORKSPACE_DIR
    process.env.RESOURCES_DIR = originalEnv.RESOURCES_DIR
    resetPathsCache()
    resetSkillsSnapshotVersion()

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  test('keeps agent workspace skills out of global skill listing and applies precedence per agent', () => {
    const root = makeTempDir('youclaw-skills-loader-')
    const resourcesDir = resolve(root, 'resources')
    const dataDir = resolve(root, 'data')
    const workspaceDir = resolve(root, 'workspace')

    process.env.RESOURCES_DIR = resourcesDir
    process.env.DATA_DIR = dataDir
    process.env.WORKSPACE_DIR = workspaceDir
    resetPathsCache()

    writeSkill(resolve(resourcesDir, 'skills'), 'shared-skill', 'Builtin shared', 'builtin version')
    writeSkill(resolve(dataDir, 'skills'), 'shared-skill', 'User shared', 'user version')
    writeSkill(resolve(workspaceDir, 'agents', 'agent-a', 'skills'), 'shared-skill', 'Workspace shared', 'workspace version')
    writeSkill(resolve(workspaceDir, 'agents', 'agent-b', 'skills'), 'agent-only', 'Agent B only', 'workspace only')

    const loader = new SkillsLoader()

    const globalSkills = loader.loadAllSkills()
    expect(globalSkills.map((skill) => skill.name)).toEqual(['shared-skill'])
    expect(globalSkills[0]?.source).toBe('user')

    const agentASkills = loader.loadAllSkillsForAgent(createAgentConfig('agent-a', workspaceDir))
    expect(agentASkills.find((skill) => skill.name === 'shared-skill')?.source).toBe('workspace')
    expect(agentASkills.find((skill) => skill.name === 'shared-skill')?.content).toContain('workspace version')

    const agentBSkills = loader.loadAllSkillsForAgent(createAgentConfig('agent-b', workspaceDir))
    expect(agentBSkills.find((skill) => skill.name === 'shared-skill')?.source).toBe('user')
    expect(agentBSkills.find((skill) => skill.name === 'agent-only')?.source).toBe('workspace')
  })

  test('builds versioned snapshots for agent runtime', () => {
    const root = makeTempDir('youclaw-skills-snapshot-')
    const resourcesDir = resolve(root, 'resources')
    const dataDir = resolve(root, 'data')
    const workspaceDir = resolve(root, 'workspace')

    process.env.RESOURCES_DIR = resourcesDir
    process.env.DATA_DIR = dataDir
    process.env.WORKSPACE_DIR = workspaceDir
    resetPathsCache()

    writeSkill(resolve(resourcesDir, 'skills'), 'builtin-skill', 'Builtin', 'builtin body')
    writeSkill(resolve(workspaceDir, 'agents', 'agent-a', 'skills'), 'workspace-skill', 'Workspace', 'workspace body')

    const loader = new SkillsLoader()
    const agentConfig = createAgentConfig('agent-a', workspaceDir, ['builtin-skill', 'workspace-skill'])

    const firstSnapshot = loader.buildSnapshotForAgent(agentConfig)
    expect(firstSnapshot.version).toBe(0)
    expect(firstSnapshot.skills.map((skill) => skill.name)).toEqual(['builtin-skill', 'workspace-skill'])

    loader.refresh()

    const secondSnapshot = loader.buildSnapshotForAgent(agentConfig)
    expect(secondSnapshot.version).toBeGreaterThan(firstSnapshot.version)
    expect(secondSnapshot.resolvedSkills.map((skill) => skill.name)).toEqual(['builtin-skill', 'workspace-skill'])
  })
})
