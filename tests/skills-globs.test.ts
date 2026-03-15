import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { matchSkillGlobs, scanWorkspaceFiles } from '../src/skills/globs.ts'
import type { Skill } from '../src/skills/types.ts'

let workspaceDir = ''

function createSkill(globs?: string[]): Skill {
  return {
    name: 'demo',
    source: 'workspace',
    frontmatter: {
      name: 'demo',
      description: 'demo skill',
      globs,
    },
    content: 'body',
    path: '/tmp/demo/SKILL.md',
    eligible: true,
    eligibilityErrors: [],
    eligibilityDetail: {
      os: { passed: true, current: process.platform },
      dependencies: { passed: true, results: [] },
      env: { passed: true, results: [] },
    },
    loadedAt: Date.now(),
    enabled: true,
    usable: true,
  }
}

describe('scanWorkspaceFiles', () => {
  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'youclaw-skill-globs-'))
  })

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true })
  })

  test('returns workspace files excluding .git, node_modules, and data', () => {
    mkdirSync(join(workspaceDir, 'src'), { recursive: true })
    mkdirSync(join(workspaceDir, '.git'), { recursive: true })
    mkdirSync(join(workspaceDir, 'node_modules/pkg'), { recursive: true })
    mkdirSync(join(workspaceDir, 'data/ipc'), { recursive: true })

    writeFileSync(join(workspaceDir, 'README.md'), '# repo')
    writeFileSync(join(workspaceDir, 'src/index.ts'), 'export {}')
    writeFileSync(join(workspaceDir, '.git/config'), '[core]')
    writeFileSync(join(workspaceDir, 'node_modules/pkg/index.js'), 'module.exports = {}')
    writeFileSync(join(workspaceDir, 'data/ipc/task.json'), '{}')

    const files = scanWorkspaceFiles(workspaceDir).sort()

    expect(files).toEqual(['README.md', 'src/index.ts'])
  })

  test('returns empty array when directory does not exist', () => {
    expect(scanWorkspaceFiles(join(workspaceDir, 'missing'))).toEqual([])
  })
})

describe('matchSkillGlobs', () => {
  test('matches by default when no globs are specified', () => {
    expect(matchSkillGlobs(createSkill(), ['src/index.ts'])).toBe(true)
    expect(matchSkillGlobs(createSkill([]), ['src/index.ts'])).toBe(true)
  })

  test('returns true when any glob matches', () => {
    const matched = matchSkillGlobs(createSkill(['**/*.ts', '**/*.tsx']), ['README.md', 'src/index.ts'])
    const notMatched = matchSkillGlobs(createSkill(['**/*.py']), ['README.md', 'src/index.ts'])

    expect(matched).toBe(true)
    expect(notMatched).toBe(false)
  })
})
