import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import './setup.ts'
import { AgentManager } from '../src/agent/manager.ts'
import { getPaths, resetPathsCache } from '../src/config/index.ts'
import { SkillsLoader } from '../src/skills/loader.ts'

const originalEnv = {
  DATA_DIR: process.env.DATA_DIR,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  WORKSPACE_DIR: process.env.WORKSPACE_DIR,
}

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function configurePathEnv(): { dataDir: string; homeDir: string } {
  const homeDir = makeTempDir('youclaw-home-')
  const dataDir = resolve(makeTempDir('youclaw-data-'), 'com.youclaw.app')
  process.env.HOME = homeDir
  delete process.env.USERPROFILE
  process.env.DATA_DIR = dataDir
  delete process.env.WORKSPACE_DIR
  resetPathsCache()
  return { dataDir, homeDir }
}

describe('storage paths', () => {
  beforeEach(() => {
    resetPathsCache()
  })

  afterEach(() => {
    process.env.DATA_DIR = originalEnv.DATA_DIR
    process.env.HOME = originalEnv.HOME
    process.env.USERPROFILE = originalEnv.USERPROFILE
    process.env.WORKSPACE_DIR = originalEnv.WORKSPACE_DIR
    resetPathsCache()

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  test('stores workspace and user skills under the resolved data directory', () => {
    const { dataDir } = configurePathEnv()

    const paths = getPaths()

    expect(paths.data).toBe(dataDir)
    expect(paths.workspace).toBe(resolve(dataDir, 'workspace'))
    expect(paths.agents).toBe(resolve(dataDir, 'workspace', 'agents'))
    expect(paths.userSkills).toBe(resolve(dataDir, 'skills'))
  })

  test('migrates legacy user skills into the app data skills directory', () => {
    const { homeDir } = configurePathEnv()
    const skillName = 'legacy-user-skill-test'
    const legacySkillDir = resolve(homeDir, '.youclaw', 'skills', skillName)
    mkdirSync(legacySkillDir, { recursive: true })
    writeFileSync(resolve(legacySkillDir, 'SKILL.md'), `---\nname: ${skillName}\ndescription: legacy\n---\n`)

    const loader = new SkillsLoader()
    loader.loadAllSkills(true)

    const migratedSkillPath = resolve(getPaths().userSkills, skillName, 'SKILL.md')
    expect(existsSync(migratedSkillPath)).toBe(true)
    expect(readFileSync(migratedSkillPath, 'utf-8')).toContain(`name: ${skillName}`)
  })

  test('migrates legacy agent workspaces into the app data workspace', () => {
    const { homeDir } = configurePathEnv()
    const legacyAgentDir = resolve(homeDir, '.youclaw', 'workspace', 'agents', 'default')
    mkdirSync(legacyAgentDir, { recursive: true })
    writeFileSync(resolve(legacyAgentDir, 'agent.yaml'), 'id: default\nname: Legacy Default\n')

    const manager = new AgentManager({} as any, {} as any)
    manager.ensureDefaultAgent()

    const migratedAgentPath = resolve(getPaths().agents, 'default', 'agent.yaml')
    expect(existsSync(migratedAgentPath)).toBe(true)
    expect(readFileSync(migratedAgentPath, 'utf-8')).toContain('Legacy Default')
  })
})
