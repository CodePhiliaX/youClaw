import { describe, test, expect, beforeEach, mock, afterEach } from 'bun:test'
import { RegistryManager } from './registry.ts'
import type { SkillsLoader } from './loader.ts'
import type { Skill } from './types.ts'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

// Initialize env and logger (required by RegistryManager internally)
import { loadEnv } from '../config/index.ts'
import { initLogger } from '../logger/index.ts'
loadEnv()
initLogger()

/** Create mock SkillsLoader */
function createMockLoader(skills: Partial<Skill>[] = []): SkillsLoader {
  return {
    loadAllSkills: () => skills as Skill[],
    refresh: () => skills as Skill[],
  } as unknown as SkillsLoader
}

describe('RegistryManager', () => {
  describe('getRecommended', () => {
    test('returns recommended list with correct fields', () => {
      const manager = new RegistryManager(createMockLoader())
      const list = manager.getRecommended()

      expect(list.length).toBe(10)
      // Each item has required fields
      for (const item of list) {
        expect(typeof item.slug).toBe('string')
        expect(typeof item.displayName).toBe('string')
        expect(typeof item.summary).toBe('string')
        expect(typeof item.category).toBe('string')
        expect(typeof item.installed).toBe('boolean')
      }
      expect(list[0].slug).toBe('self-improving-agent')
      expect(list[0].displayName).toBe('Self Improving Agent')
      expect(list[0].category).toBe('agent')
    })

    test('marks installed skill as installed=true (via registryMeta)', () => {
      const manager = new RegistryManager(createMockLoader([
        {
          name: 'DuckDuckGo Web Search',
          source: 'user',
          registryMeta: {
            source: 'clawhub',
            slug: 'ddg-web-search',
            installedAt: '2024-01-01',
            displayName: 'DuckDuckGo Web Search',
          },
        },
      ]))
      const list = manager.getRecommended()

      const ddg = list.find(s => s.slug === 'ddg-web-search')!
      expect(ddg.installed).toBe(true)
    })

    test('marks installed skill as installed=true (via directory detection)', () => {
      const userSkillsDir = resolve(homedir(), '.youclaw', 'skills')
      const testDir = resolve(userSkillsDir, 'coding')

      // Create test directory
      mkdirSync(testDir, { recursive: true })
      writeFileSync(resolve(testDir, 'SKILL.md'), '---\nname: coding\ndescription: test\n---\n')

      try {
        const manager = new RegistryManager(createMockLoader())
        const list = manager.getRecommended()

        const coding = list.find(s => s.slug === 'coding')!
        expect(coding.installed).toBe(true)
      } finally {
        // Clean up
        rmSync(testDir, { recursive: true, force: true })
      }
    })
  })

  describe('installSkill', () => {
    test('throws error for unknown slug', async () => {
      const manager = new RegistryManager(createMockLoader())
      await expect(manager.installSkill('unknown-skill')).rejects.toThrow('Unknown recommended skill')
    })

    test('throws error for already installed skill', async () => {
      const userSkillsDir = resolve(homedir(), '.youclaw', 'skills')
      const testDir = resolve(userSkillsDir, 'ddg-web-search')

      mkdirSync(testDir, { recursive: true })
      writeFileSync(resolve(testDir, 'SKILL.md'), '---\nname: ddg\ndescription: test\n---\n')

      try {
        const manager = new RegistryManager(createMockLoader())
        await expect(manager.installSkill('ddg-web-search')).rejects.toThrow('already installed')
      } finally {
        rmSync(testDir, { recursive: true, force: true })
      }
    })
  })

  describe('uninstallSkill', () => {
    test('throws error for uninstalled skill', async () => {
      const slug = `test-uninstall-${Date.now()}`
      const manager = new RegistryManager(createMockLoader())
      await expect(manager.uninstallSkill(slug)).rejects.toThrow('is not installed')
    })

    test('can uninstall an installed skill', async () => {
      const slug = `test-uninstall-${Date.now()}`
      const userSkillsDir = resolve(homedir(), '.youclaw', 'skills')
      const testDir = resolve(userSkillsDir, slug)

      mkdirSync(testDir, { recursive: true })
      writeFileSync(resolve(testDir, 'SKILL.md'), '---\nname: test\ndescription: test\n---\n')

      const manager = new RegistryManager(createMockLoader())
      await manager.uninstallSkill(slug)

      expect(existsSync(testDir)).toBe(false)
    })
  })
})
