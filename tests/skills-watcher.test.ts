import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import './setup.ts'
import { resetPathsCache } from '../src/config/index.ts'
import { initLogger } from '../src/logger/index.ts'
import { SkillsLoader, SkillsWatcher, resetSkillsSnapshotVersion } from '../src/skills/index.ts'

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

describe('SkillsWatcher', () => {
  beforeEach(() => {
    resetPathsCache()
    resetSkillsSnapshotVersion()
    initLogger()
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

  test('creates writable roots before watching so later-added skills are observable', () => {
    const root = makeTempDir('youclaw-skills-watcher-')
    process.env.DATA_DIR = resolve(root, 'data')
    process.env.WORKSPACE_DIR = resolve(root, 'workspace')
    process.env.RESOURCES_DIR = resolve(root, 'resources')
    resetPathsCache()

    const watcher = new SkillsWatcher(new SkillsLoader())

    expect(existsSync(resolve(root, 'data', 'skills'))).toBe(false)
    expect(existsSync(resolve(root, 'workspace', 'agents'))).toBe(false)

    watcher.start()

    expect(existsSync(resolve(root, 'data', 'skills'))).toBe(true)
    expect(existsSync(resolve(root, 'workspace', 'agents'))).toBe(true)

    watcher.stop()
  })
})
