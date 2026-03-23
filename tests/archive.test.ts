import { describe, expect, test } from 'bun:test'
import { strToU8, zipSync } from 'fflate'
import { assertPathInsideRoot, MAX_ARCHIVE_ENTRY_BYTES, unpackZipArchive } from '../src/skills/archive.ts'

describe('unpackZipArchive', () => {
  test('ignores oversized files outside the selected prefix', () => {
    const zip = zipSync({
      'repo-main/skills/github-ops/SKILL.md': strToU8('# GitHub Ops'),
      'repo-main/demos/ppt-creator/create-presentation.gif': new Uint8Array(MAX_ARCHIVE_ENTRY_BYTES + 1),
    })

    const entries = unpackZipArchive(zip, 'skills/github-ops')

    expect(entries).toHaveLength(1)
    expect(entries[0]?.relativePath).toBe('SKILL.md')
  })

  test('still rejects oversized files inside the selected prefix', () => {
    const zip = zipSync({
      'repo-main/skills/github-ops/SKILL.md': strToU8('# GitHub Ops'),
      'repo-main/skills/github-ops/demo.gif': new Uint8Array(MAX_ARCHIVE_ENTRY_BYTES + 1),
    })

    expect(() => unpackZipArchive(zip, 'skills/github-ops')).toThrow('Archive entry is too large')
  })
})

describe('assertPathInsideRoot', () => {
  test('accepts nested Windows paths inside the target directory', () => {
    expect(() => assertPathInsideRoot(
      'C:\\youclaw-test\\skills\\tmp',
      'C:\\youclaw-test\\skills\\tmp\\github-ops\\SKILL.md',
    )).not.toThrow()
  })

  test('rejects Windows paths outside the target directory', () => {
    expect(() => assertPathInsideRoot(
      'C:\\youclaw-test\\skills\\tmp',
      'C:\\youclaw-test\\skills\\other\\SKILL.md',
    )).toThrow('Archive entry escapes target directory')
  })
})
