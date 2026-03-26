import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import './setup.ts'
import {
  getLegacyProductionDataDir,
  getPaths,
  getProductionDataDir,
  resetPathsCache,
  resolveProductionDataDir,
} from '../src/config/index.ts'

const originalEnv = {
  DATA_DIR: process.env.DATA_DIR,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  WORKSPACE_DIR: process.env.WORKSPACE_DIR,
  APPDATA: process.env.APPDATA,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
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
    process.env.APPDATA = originalEnv.APPDATA
    process.env.XDG_DATA_HOME = originalEnv.XDG_DATA_HOME
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

  test('expands ~ in an explicit DATA_DIR', () => {
    const homeDir = makeTempDir('youclaw-home-')
    process.env.HOME = homeDir
    delete process.env.USERPROFILE
    process.env.DATA_DIR = '~/.youclaw-dev'
    resetPathsCache()

    const paths = getPaths()

    expect(paths.data).toBe(resolve(homeDir, '.youclaw-dev'))
  })

  test('uses ~/.youclaw as the production data directory', () => {
    const homeDir = makeTempDir('youclaw-home-')
    process.env.HOME = homeDir
    delete process.env.USERPROFILE

    expect(getProductionDataDir()).toBe(resolve(homeDir, '.youclaw'))
  })

  test('migrates the legacy production data directory into ~/.youclaw', () => {
    const homeDir = makeTempDir('youclaw-home-')
    process.env.HOME = homeDir
    delete process.env.USERPROFILE
    delete process.env.DATA_DIR
    process.env.APPDATA = resolve(homeDir, 'AppData', 'Roaming')
    process.env.XDG_DATA_HOME = resolve(homeDir, '.local', 'share')

    const legacyDir = getLegacyProductionDataDir()
    const targetDir = getProductionDataDir()
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(resolve(legacyDir, 'sample.txt'), 'migrated', 'utf-8')
    resetPathsCache()

    const resolvedDir = resolveProductionDataDir()

    expect(resolvedDir).toBe(targetDir)
    expect(readFileSync(resolve(targetDir, 'sample.txt'), 'utf-8')).toBe('migrated')
    expect(existsSync(legacyDir)).toBe(false)
  })
})
