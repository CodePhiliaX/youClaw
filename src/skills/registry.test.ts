import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { loadEnv } from '../config/index.ts'
import { initLogger } from '../logger/index.ts'
import { RegistryManager } from './registry.ts'
import type { SkillsLoader } from './loader.ts'
import type { Skill, SkillRegistryMeta } from './types.ts'
import recommendedSkillsData from './recommended-skills.json'

loadEnv()
initLogger()

const apiBaseUrl = 'https://registry.test/api/v1'
const downloadUrl = `${apiBaseUrl}/download`
const testUserSkillsDir = resolve('/tmp', `youclaw-registry-test-${process.pid}`)

function createMockLoader(skills: Partial<Skill>[] = []) {
  let refreshCount = 0
  const loader = {
    loadAllSkills: () => skills as Skill[],
    refresh: () => {
      refreshCount += 1
      return skills as Skill[]
    },
  } as unknown as SkillsLoader

  return {
    loader,
    getRefreshCount: () => refreshCount,
  }
}

function createClawhubMeta(slug: string, version?: string): SkillRegistryMeta {
  return {
    source: 'clawhub',
    slug,
    installedAt: '2024-01-01T00:00:00.000Z',
    displayName: slug,
    version,
  }
}

function createSkillZip(files: Record<string, string>) {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([filePath, content]) => [filePath, strToU8(content)]),
    ),
  )
}

function getUserSkillDir(slug: string) {
  return resolve(testUserSkillsDir, slug)
}

function createRegistryManager(
  loader: SkillsLoader,
  fetchImpl: typeof fetch,
) {
  return new RegistryManager(loader, {
    userSkillsDir: testUserSkillsDir,
    apiBaseUrl,
    downloadUrl,
    fetchImpl,
    sleep: async () => {},
  })
}

describe('RegistryManager', () => {
  beforeEach(() => {
    rmSync(testUserSkillsDir, { recursive: true, force: true })
    mkdirSync(testUserSkillsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testUserSkillsDir, { recursive: true, force: true })
  })

  describe('getRecommended', () => {
    test('returns fallback recommendations with normalized fields', () => {
      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async () => new Response('nope', { status: 500 }))
      const list = manager.getRecommended()

      expect(list.length).toBe(10)
      expect(list[0]).toMatchObject({
        slug: 'self-improving-agent',
        displayName: 'self-improving-agent',
        category: 'agent',
        source: 'fallback',
      })
    })

    test('bundled recommendations use unique slugs and supported categories', () => {
      const supportedCategories = new Set(['agent', 'search', 'browser', 'coding'])
      const slugs = new Set<string>()

      for (const entry of recommendedSkillsData) {
        expect(entry.slug.length).toBeGreaterThan(0)
        expect(entry.displayName.length).toBeGreaterThan(0)
        expect(entry.summary.length).toBeGreaterThan(0)
        expect(supportedCategories.has(entry.category)).toBe(true)
        expect(slugs.has(entry.slug)).toBe(false)
        slugs.add(entry.slug)
      }
    })

    test('merges installed registry metadata into fallback items', () => {
      const skillDir = getUserSkillDir('coding')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(resolve(skillDir, 'SKILL.md'), '---\nname: coding-helper\ndescription: test\n---\n')
      writeFileSync(resolve(skillDir, '.registry.json'), JSON.stringify(createClawhubMeta('coding', '1.0.0')))

      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async () => new Response('nope', { status: 500 }))
      const list = manager.getRecommended()
      const coding = list.find((skill) => skill.slug === 'coding')!

      expect(coding.installed).toBe(true)
      expect(coding.installedSkillName).toBe('coding-helper')
      expect(coding.installSource).toBe('clawhub')
      expect(coding.installedVersion).toBe('1.0.0')
    })
  })

  describe('listMarketplace', () => {
    test('returns bundled recommendations when query is empty', async () => {
      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async () => {
        throw new Error('should not fetch remote marketplace for empty queries')
      })

      const result = await manager.listMarketplace()

      expect(result.source).toBe('fallback')
      expect(result.query).toBe('')
      expect(result.nextCursor).toBeNull()
      expect(result.items.length).toBeGreaterThan(0)
    })

    test('remote search merges installed state and update availability', async () => {
      const skillDir = getUserSkillDir('coding')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(resolve(skillDir, 'SKILL.md'), '---\nname: coding-helper\ndescription: test\n---\n')
      writeFileSync(resolve(skillDir, '.registry.json'), JSON.stringify(createClawhubMeta('coding', '1.0.0')))

      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async (url) => {
        if (String(url) === `${apiBaseUrl}/search?q=coding&limit=50&nonSuspiciousOnly=true`) {
          return Response.json({
            results: [
              {
                slug: 'coding',
                displayName: 'Coding',
                summary: 'Ship code',
                score: 0.98,
                updatedAt: 2,
                version: '1.2.0',
              },
            ],
          })
        }
        return new Response('not found', { status: 404 })
      })

      const result = await manager.listMarketplace({ query: 'coding' })

      expect(result.source).toBe('clawhub')
      expect(result.query).toBe('coding')
      expect(result.items[0]).toMatchObject({
        slug: 'coding',
        installed: true,
        installedSkillName: 'coding-helper',
        installedVersion: '1.0.0',
        latestVersion: '1.2.0',
        hasUpdate: true,
        source: 'clawhub',
      })
    })

    test('falls back to the bundled recommendations when remote loading fails', async () => {
      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async () => new Response('boom', { status: 500 }))

      const result = await manager.listMarketplace({ query: 'coding', limit: 2 })

      expect(result.source).toBe('fallback')
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items.every((item) => item.displayName || item.summary)).toBe(true)
    })
  })

  describe('getMarketplaceSkill', () => {
    test('includes the installed local skill name in marketplace detail', async () => {
      const skillDir = getUserSkillDir('coding')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(resolve(skillDir, 'SKILL.md'), '---\nname: coding-helper\ndescription: test\n---\n')
      writeFileSync(resolve(skillDir, '.registry.json'), JSON.stringify(createClawhubMeta('coding', '1.0.0')))

      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async (url) => {
        if (String(url) === `${apiBaseUrl}/skills/coding`) {
          return Response.json({
            skill: {
              slug: 'coding',
              displayName: 'Coding',
              summary: 'Ship code',
              tags: { latest: '2.0.0', coding: '2.0.0' },
              stats: { downloads: 8, stars: 5, installsCurrent: 2, installsAllTime: 7 },
              createdAt: 10,
              updatedAt: 20,
            },
            latestVersion: { version: '2.0.0' },
          })
        }
        return new Response('not found', { status: 404 })
      })

      const detail = await manager.getMarketplaceSkill('coding')

      expect(detail.installed).toBe(true)
      expect(detail.installedSkillName).toBe('coding-helper')
      expect(detail.installedVersion).toBe('1.0.0')
    })

    test('reads remote skill detail', async () => {
      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async (url) => {
        if (String(url) === `${apiBaseUrl}/skills/coding`) {
          return Response.json({
            skill: {
              slug: 'coding',
              displayName: 'Coding',
              summary: 'Ship code',
              tags: { latest: '2.0.0', coding: '2.0.0' },
              stats: { downloads: 8, stars: 5, installsCurrent: 2, installsAllTime: 7 },
              createdAt: 10,
              updatedAt: 20,
            },
            latestVersion: { version: '2.0.0' },
            metadata: { os: ['linux'], systems: ['x86_64-linux'] },
            owner: { handle: 'jerry', displayName: 'Jerry' },
            moderation: { verdict: 'clean', isSuspicious: false, isMalwareBlocked: false },
          })
        }
        return new Response('not found', { status: 404 })
      })

      const detail = await manager.getMarketplaceSkill('coding')

      expect(detail).toMatchObject({
        slug: 'coding',
        displayName: 'Coding',
        latestVersion: '2.0.0',
        ownerHandle: 'jerry',
        ownerDisplayName: 'Jerry',
      })
      expect(detail.metadata).toEqual({ os: ['linux'], systems: ['x86_64-linux'] })
    })
  })

  describe('installSkill', () => {
    test('throws when the remote skill does not exist', async () => {
      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async () => new Response('missing', { status: 404 }))

      await expect(manager.installSkill('unknown-skill')).rejects.toThrow('404')
    })

    test('downloads an archive and writes skill files plus registry metadata', async () => {
      const { loader, getRefreshCount } = createMockLoader()
      const zip = createSkillZip({
        'coding/SKILL.md': '---\nname: coding\ndescription: Search web\n---\n',
        'coding/README.txt': 'hello',
      })
      const manager = createRegistryManager(loader, async (url) => {
        if (String(url) === `${apiBaseUrl}/skills/coding`) {
          return Response.json({
            skill: {
              slug: 'coding',
              displayName: 'Coding',
              summary: 'Ship code',
              tags: { latest: '1.2.3' },
              stats: {},
              createdAt: 1,
              updatedAt: 2,
            },
            latestVersion: { version: '1.2.3' },
          })
        }
        if (String(url) === `${downloadUrl}?slug=coding`) {
          return new Response(zip, {
            status: 200,
            headers: { 'content-length': String(zip.byteLength) },
          })
        }
        return new Response('not found', { status: 404 })
      })

      await manager.installSkill('coding')

      const skillDir = getUserSkillDir('coding')
      expect(existsSync(resolve(skillDir, 'SKILL.md'))).toBe(true)
      expect(existsSync(resolve(skillDir, 'README.txt'))).toBe(true)
      const meta = JSON.parse(readFileSync(resolve(skillDir, '.registry.json'), 'utf-8')) as SkillRegistryMeta
      expect(meta.source).toBe('clawhub')
      expect(meta.slug).toBe('coding')
      expect(meta.version).toBe('1.2.3')
      expect(getRefreshCount()).toBe(1)
    })

    test('retries once after a 429 response', async () => {
      const { loader } = createMockLoader()
      const zip = createSkillZip({
        'SKILL.md': '---\nname: coding\ndescription: Coding skill\n---\n',
      })
      let attempts = 0
      const manager = createRegistryManager(loader, async (url) => {
        if (String(url) === `${apiBaseUrl}/skills/coding`) {
          return Response.json({
            skill: {
              slug: 'coding',
              displayName: 'Coding',
              summary: 'Ship code',
              tags: { latest: '1.0.0' },
              stats: {},
              createdAt: 1,
              updatedAt: 2,
            },
            latestVersion: { version: '1.0.0' },
          })
        }
        if (String(url) === `${downloadUrl}?slug=coding`) {
          attempts += 1
          if (attempts === 1) {
            return new Response('slow down', {
              status: 429,
              headers: { 'retry-after': '0' },
            })
          }
          return new Response(zip, {
            status: 200,
            headers: { 'content-length': String(zip.byteLength) },
          })
        }
        return new Response('not found', { status: 404 })
      })

      await manager.installSkill('coding')

      expect(attempts).toBe(2)
      expect(existsSync(resolve(getUserSkillDir('coding'), 'SKILL.md'))).toBe(true)
    })

    test('cleans up when the archive is missing a root SKILL.md', async () => {
      const { loader } = createMockLoader()
      const zip = createSkillZip({
        'docs/readme.txt': 'oops',
      })
      const manager = createRegistryManager(loader, async (url) => {
        if (String(url) === `${apiBaseUrl}/skills/coding`) {
          return Response.json({
            skill: {
              slug: 'coding',
              displayName: 'Coding',
              summary: 'Ship code',
              tags: { latest: '1.0.0' },
              stats: {},
            },
            latestVersion: { version: '1.0.0' },
          })
        }
        if (String(url) === `${downloadUrl}?slug=coding`) {
          return new Response(zip, { status: 200 })
        }
        return new Response('not found', { status: 404 })
      })

      await expect(manager.installSkill('coding')).rejects.toThrow('SKILL.md')
      expect(existsSync(getUserSkillDir('coding'))).toBe(false)
    })

    test('rejects path traversal entries and cleans up', async () => {
      const { loader } = createMockLoader()
      const zip = createSkillZip({
        'coding/SKILL.md': '---\nname: coding\ndescription: Coding skill\n---\n',
        'coding/../escape.txt': 'bad',
      })
      const manager = createRegistryManager(loader, async (url) => {
        if (String(url) === `${apiBaseUrl}/skills/coding`) {
          return Response.json({
            skill: {
              slug: 'coding',
              displayName: 'Coding',
              summary: 'Ship code',
              tags: { latest: '1.0.0' },
              stats: {},
            },
            latestVersion: { version: '1.0.0' },
          })
        }
        if (String(url) === `${downloadUrl}?slug=coding`) {
          return new Response(zip, { status: 200 })
        }
        return new Response('not found', { status: 404 })
      })

      await expect(manager.installSkill('coding')).rejects.toThrow('illegal file path')
      expect(existsSync(getUserSkillDir('coding'))).toBe(false)
    })
  })

  describe('updateSkill', () => {
    test('updates an installed ClawHub skill and writes the new version', async () => {
      const skillDir = getUserSkillDir('coding')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(resolve(skillDir, 'SKILL.md'), '---\nname: coding\ndescription: old\n---\n')
      writeFileSync(resolve(skillDir, '.registry.json'), JSON.stringify(createClawhubMeta('coding', '1.0.0')))

      const { loader, getRefreshCount } = createMockLoader()
      const zip = createSkillZip({
        'coding/SKILL.md': '---\nname: coding\ndescription: new\n---\n',
        'coding/README.txt': 'updated',
      })
      const manager = createRegistryManager(loader, async (url) => {
        if (String(url) === `${apiBaseUrl}/skills/coding`) {
          return Response.json({
            skill: {
              slug: 'coding',
              displayName: 'Coding',
              summary: 'Ship code',
              tags: { latest: '1.1.0' },
              stats: {},
            },
            latestVersion: { version: '1.1.0' },
          })
        }
        if (String(url) === `${downloadUrl}?slug=coding`) {
          return new Response(zip, { status: 200 })
        }
        return new Response('not found', { status: 404 })
      })

      await manager.updateSkill('coding')

      const meta = JSON.parse(readFileSync(resolve(skillDir, '.registry.json'), 'utf-8')) as SkillRegistryMeta
      expect(meta.version).toBe('1.1.0')
      expect(readFileSync(resolve(skillDir, 'README.txt'), 'utf-8')).toBe('updated')
      expect(getRefreshCount()).toBe(1)
    })

    test('rejects an update when the installed version is already current', async () => {
      const skillDir = getUserSkillDir('coding')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(resolve(skillDir, 'SKILL.md'), '---\nname: coding\ndescription: old\n---\n')
      writeFileSync(resolve(skillDir, '.registry.json'), JSON.stringify(createClawhubMeta('coding', '1.1.0')))

      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async (url) => {
        if (String(url) === `${apiBaseUrl}/skills/coding`) {
          return Response.json({
            skill: {
              slug: 'coding',
              displayName: 'Coding',
              summary: 'Ship code',
              tags: { latest: '1.1.0' },
              stats: {},
            },
            latestVersion: { version: '1.1.0' },
          })
        }
        return new Response('not found', { status: 404 })
      })

      await expect(manager.updateSkill('coding')).rejects.toThrow('already up to date')
    })
  })

  describe('uninstallSkill', () => {
    test('throws when the skill is not installed', async () => {
      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async () => new Response('nope', { status: 500 }))
      await expect(manager.uninstallSkill('coding')).rejects.toThrow('is not installed')
    })

    test('rejects uninstall for skills not installed from ClawHub', async () => {
      const skillDir = getUserSkillDir('coding')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(resolve(skillDir, 'SKILL.md'), '---\nname: coding\ndescription: test\n---\n')

      const { loader } = createMockLoader()
      const manager = createRegistryManager(loader, async () => new Response('nope', { status: 500 }))

      await expect(manager.uninstallSkill('coding')).rejects.toThrow('was not installed from ClawHub')
    })

    test('uninstalls skills that were installed from ClawHub', async () => {
      const skillDir = getUserSkillDir('coding')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(resolve(skillDir, 'SKILL.md'), '---\nname: coding\ndescription: test\n---\n')
      writeFileSync(resolve(skillDir, '.registry.json'), JSON.stringify(createClawhubMeta('coding', '1.0.0')))

      const { loader, getRefreshCount } = createMockLoader()
      const manager = createRegistryManager(loader, async () => new Response('nope', { status: 500 }))
      await manager.uninstallSkill('coding')

      expect(existsSync(skillDir)).toBe(false)
      expect(getRefreshCount()).toBe(1)
    })
  })
})
