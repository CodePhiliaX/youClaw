import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import './setup.ts'
import { getPaths } from '../src/config/index.ts'
import { ImportManager } from '../src/skills/import-manager.ts'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

function textResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...(init.headers ?? {}) },
  })
}

function collectFiles(root: string, current = root): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of readdirSync(current)) {
    const absolutePath = join(current, entry)
    const relativePath = absolutePath.slice(root.length + 1)
    if (statSync(absolutePath).isDirectory()) {
      Object.assign(files, collectFiles(root, absolutePath))
      continue
    }
    files[relativePath] = readFileSync(absolutePath, 'utf-8')
  }
  return files
}

describe('ImportManager', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('uses the user skills directory by default for raw URL imports', async () => {
    let capturedTargetDir = ''

    const manager = new ImportManager({
      installFromUrl: async (_url: string, targetDir: string) => {
        capturedTargetDir = targetDir
      },
    } as any)

    await manager.import('raw-url', {
      url: 'https://example.com/SKILL.md',
    })

    expect(capturedTargetDir).toBe(getPaths().userSkills)
  })

  test('probes a GitHub blob SKILL.md URL as a single file target', async () => {
    const requests: string[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)

      if (url === 'https://api.github.com/repos/acme/tools/contents/skills/github-ops/SKILL.md?ref=main') {
        return jsonResponse({
          type: 'file',
          name: 'SKILL.md',
          path: 'skills/github-ops/SKILL.md',
          encoding: 'base64',
          content: Buffer.from('---\nname: github-ops\ndescription: GitHub helper\n---\n').toString('base64'),
          size: 55,
        })
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const manager = new ImportManager({} as any)
    const result = await manager.probe('github', {
      repoUrl: 'https://github.com/acme/tools/blob/main/skills/github-ops/SKILL.md',
    })

    expect(result).toMatchObject({
      provider: 'github',
      ok: true,
      suggestedName: 'github-ops',
      summary: 'GitHub helper',
      metadata: {
        targetKind: 'skill-file',
        owner: 'acme',
        repo: 'tools',
        ref: 'main',
        path: 'skills/github-ops/SKILL.md',
      },
    })
    expect(requests).toEqual([
      'https://api.github.com/repos/acme/tools/contents/skills/github-ops/SKILL.md?ref=main',
    ])
  })

  test('imports only the selected GitHub directory tree instead of downloading the whole repository', async () => {
    const requests: string[] = []
    const installed: Array<{ sourcePath: string; targetDir: string; metadata: Record<string, unknown> | undefined }> = []

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)

      if (url === 'https://api.github.com/repos/acme/tools/contents/skills/github-ops/SKILL.md?ref=main') {
        return jsonResponse({
          type: 'file',
          name: 'SKILL.md',
          path: 'skills/github-ops/SKILL.md',
          download_url: 'https://raw.githubusercontent.com/acme/tools/main/skills/github-ops/SKILL.md',
          size: 64,
        })
      }
      if (url === 'https://api.github.com/repos/acme/tools/contents/skills/github-ops?ref=main') {
        return jsonResponse([
          {
            type: 'file',
            name: 'SKILL.md',
            path: 'skills/github-ops/SKILL.md',
            download_url: 'https://raw.githubusercontent.com/acme/tools/main/skills/github-ops/SKILL.md',
            size: 64,
          },
          {
            type: 'file',
            name: 'README.md',
            path: 'skills/github-ops/README.md',
            download_url: 'https://raw.githubusercontent.com/acme/tools/main/skills/github-ops/README.md',
            size: 16,
          },
          {
            type: 'dir',
            name: 'scripts',
            path: 'skills/github-ops/scripts',
            size: 0,
          },
        ])
      }
      if (url === 'https://api.github.com/repos/acme/tools/contents/skills/github-ops/scripts?ref=main') {
        return jsonResponse([
          {
            type: 'file',
            name: 'install.sh',
            path: 'skills/github-ops/scripts/install.sh',
            download_url: 'https://raw.githubusercontent.com/acme/tools/main/skills/github-ops/scripts/install.sh',
            size: 21,
          },
        ])
      }
      if (url === 'https://raw.githubusercontent.com/acme/tools/main/skills/github-ops/SKILL.md') {
        return textResponse('---\nname: github-ops\ndescription: GitHub helper\n---\n# GitHub Ops\n')
      }
      if (url === 'https://raw.githubusercontent.com/acme/tools/main/skills/github-ops/README.md') {
        return textResponse('# Notes\n')
      }
      if (url === 'https://raw.githubusercontent.com/acme/tools/main/skills/github-ops/scripts/install.sh') {
        return textResponse('echo install\n')
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const manager = new ImportManager({
      installFromLocal: async (sourcePath: string, targetDir: string, metadata?: Record<string, unknown>) => {
        installed.push({ sourcePath, targetDir, metadata })
        expect(collectFiles(sourcePath)).toEqual({
          'README.md': '# Notes\n',
          'SKILL.md': '---\nname: github-ops\ndescription: GitHub helper\n---\n# GitHub Ops\n',
          'scripts/install.sh': 'echo install\n',
        })
      },
    } as any)

    await manager.import('github', {
      repoUrl: 'https://github.com/acme/tools/tree/main/skills/github-ops',
      targetDir: resolve(tmpdir(), 'youclaw-import-target'),
    })

    expect(installed).toHaveLength(1)
    expect(installed[0]?.metadata).toMatchObject({
      source: 'github',
      provider: 'github',
      sourceUrl: 'https://github.com/acme/tools/tree/main/skills/github-ops',
      ref: 'main',
      path: 'skills/github-ops',
      projectOrigin: 'imported',
    })
    expect(requests.some((url) => url.includes('/zipball'))).toBe(false)
    expect(requests.some((url) => url.includes('demos/ppt-creator'))).toBe(false)
  })

  test('imports a raw.githubusercontent.com SKILL.md URL through the GitHub provider', async () => {
    const requests: string[] = []
    let installed: { metadata?: Record<string, unknown>; files: Record<string, string> } | null = null

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)

      if (url === 'https://api.github.com/repos/acme/tools/contents/skills/github-ops/SKILL.md?ref=main') {
        return jsonResponse({
          type: 'file',
          name: 'SKILL.md',
          path: 'skills/github-ops/SKILL.md',
          encoding: 'base64',
          content: Buffer.from('---\nname: github-ops\ndescription: GitHub helper\n---\n# GitHub Ops\n').toString('base64'),
          size: 68,
        })
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const manager = new ImportManager({
      installFromLocal: async (sourcePath: string, _targetDir: string, metadata?: Record<string, unknown>) => {
        installed = {
          metadata,
          files: collectFiles(sourcePath),
        }
      },
    } as any)

    await manager.import('github', {
      repoUrl: 'https://raw.githubusercontent.com/acme/tools/main/skills/github-ops/SKILL.md',
    })

    expect(installed).toEqual({
      metadata: expect.objectContaining({
        source: 'github',
        provider: 'github',
        sourceUrl: 'https://github.com/acme/tools/blob/main/skills/github-ops/SKILL.md',
        ref: 'main',
        path: 'skills/github-ops/SKILL.md',
      }),
      files: {
        'SKILL.md': '---\nname: github-ops\ndescription: GitHub helper\n---\n# GitHub Ops\n',
      },
    })
    expect(requests).toEqual([
      'https://api.github.com/repos/acme/tools/contents/skills/github-ops/SKILL.md?ref=main',
      'https://api.github.com/repos/acme/tools/contents/skills/github-ops/SKILL.md?ref=main',
    ])
  })

  test('imports a raw.githubusercontent.com refs/heads SKILL.md URL through the GitHub provider', async () => {
    const requests: string[] = []
    let installed: { metadata?: Record<string, unknown>; files: Record<string, string> } | null = null

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)

      if (url === 'https://api.github.com/repos/acme/tools/contents/skills/github-ops/SKILL.md?ref=main') {
        return jsonResponse({
          type: 'file',
          name: 'SKILL.md',
          path: 'skills/github-ops/SKILL.md',
          encoding: 'base64',
          content: Buffer.from('---\nname: github-ops\ndescription: GitHub helper\n---\n# GitHub Ops\n').toString('base64'),
          size: 68,
        })
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const manager = new ImportManager({
      installFromLocal: async (sourcePath: string, _targetDir: string, metadata?: Record<string, unknown>) => {
        installed = {
          metadata,
          files: collectFiles(sourcePath),
        }
      },
    } as any)

    await manager.import('github', {
      repoUrl: 'https://raw.githubusercontent.com/acme/tools/refs/heads/main/skills/github-ops/SKILL.md',
    })

    expect(installed).toEqual({
      metadata: expect.objectContaining({
        source: 'github',
        provider: 'github',
        sourceUrl: 'https://github.com/acme/tools/blob/main/skills/github-ops/SKILL.md',
        ref: 'main',
        path: 'skills/github-ops/SKILL.md',
      }),
      files: {
        'SKILL.md': '---\nname: github-ops\ndescription: GitHub helper\n---\n# GitHub Ops\n',
      },
    })
    expect(requests).toEqual([
      'https://api.github.com/repos/acme/tools/contents/skills/github-ops/SKILL.md?ref=main',
      'https://api.github.com/repos/acme/tools/contents/skills/github-ops/SKILL.md?ref=main',
    ])
  })

  test('rejects GitHub repository roots that are not skill directories', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url === 'https://api.github.com/repos/acme/tools/contents') {
        return jsonResponse([
          {
            type: 'dir',
            name: 'skills',
            path: 'skills',
            size: 0,
          },
        ])
      }

      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const manager = new ImportManager({} as any)

    await expect(manager.probe('github', {
      repoUrl: 'https://github.com/acme/tools',
    })).rejects.toThrow('Selected GitHub location is not a skill directory')
  })

  test('rejects GitHub blob URLs that do not point to SKILL.md', async () => {
    const manager = new ImportManager({} as any)

    await expect(manager.probe('github', {
      repoUrl: 'https://github.com/acme/tools/blob/main/skills/github-ops/README.md',
    })).rejects.toThrow('Selected GitHub file must be SKILL.md')
  })
})
