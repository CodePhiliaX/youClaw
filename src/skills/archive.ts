import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, win32 } from 'node:path'
import { unzipSync } from 'fflate'

export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
export const MAX_ARCHIVE_ENTRY_COUNT = 400
export const MAX_ARCHIVE_ENTRY_BYTES = 1024 * 1024

export interface ArchiveEntry {
  archivePath: string
  relativePath: string
  content: Uint8Array
}

interface NormalizedArchiveEntry {
  archivePath: string
  relativePath: string
  content: Uint8Array
}

function normalizeArchiveSegments(filePath: string): string[] {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.')
}

function stripCommonRoot(entries: Array<{ archivePath: string; segments: string[]; content: Uint8Array }>) {
  const hasRootFiles = entries.some((entry) => entry.segments.length === 1)
  if (hasRootFiles) {
    return entries
  }

  const firstRoot = entries[0]?.segments[0]
  if (!firstRoot) {
    return entries
  }

  if (!entries.every((entry) => entry.segments[0] === firstRoot)) {
    return entries
  }

  return entries.map((entry) => ({
    ...entry,
    segments: entry.segments.slice(1),
  }))
}

function selectEntriesWithinPrefix(entries: NormalizedArchiveEntry[], prefix?: string): NormalizedArchiveEntry[] {
  const normalizedPrefix = (prefix ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!normalizedPrefix) {
    return entries
  }

  const prefixWithSlash = `${normalizedPrefix}/`
  return entries
    .filter((entry) => entry.relativePath === normalizedPrefix || entry.relativePath.startsWith(prefixWithSlash))
    .map((entry) => ({
      ...entry,
      relativePath: entry.relativePath === normalizedPrefix
        ? ''
        : entry.relativePath.slice(prefixWithSlash.length),
    }))
    .filter((entry) => entry.relativePath.length > 0)
}

export function unpackZipArchive(zipData: Uint8Array, prefix?: string): ArchiveEntry[] {
  const files = unzipSync(zipData)
  const rawEntries = Object.entries(files)
    .filter(([filePath, content]) => !(filePath.endsWith('/') && content.length === 0))
    .map(([filePath, content]) => ({
      archivePath: filePath,
      segments: normalizeArchiveSegments(filePath),
      content,
    }))
    .filter((entry) => entry.segments.length > 0)

  if (rawEntries.length === 0) {
    throw new Error('Archive is empty')
  }

  const selectedEntries = selectEntriesWithinPrefix(
    stripCommonRoot(rawEntries).map((entry) => ({
      archivePath: entry.archivePath,
      relativePath: entry.segments.join('/'),
      content: entry.content,
    })),
    prefix,
  )

  if (selectedEntries.length > MAX_ARCHIVE_ENTRY_COUNT) {
    throw new Error(`Archive contains too many files (> ${MAX_ARCHIVE_ENTRY_COUNT})`)
  }

  for (const entry of selectedEntries) {
    if (entry.content.byteLength > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error(`Archive entry is too large: ${entry.archivePath}`)
    }
    if (normalizeArchiveSegments(entry.relativePath).some((segment) => segment === '..')) {
      throw new Error(`Archive entry has illegal file path: ${entry.archivePath}`)
    }
  }

  return selectedEntries
}

export function filterArchiveEntries(entries: ArchiveEntry[], prefix?: string): ArchiveEntry[] {
  const normalizedPrefix = (prefix ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!normalizedPrefix) {
    return entries
  }

  const prefixWithSlash = `${normalizedPrefix}/`
  return entries
    .filter((entry) => entry.relativePath === normalizedPrefix || entry.relativePath.startsWith(prefixWithSlash))
    .map((entry) => ({
      ...entry,
      relativePath: entry.relativePath === normalizedPrefix
        ? ''
        : entry.relativePath.slice(prefixWithSlash.length),
    }))
    .filter((entry) => entry.relativePath.length > 0)
}

function usesWindowsPaths(...paths: string[]): boolean {
  return paths.some((value) => /^[a-zA-Z]:[\\/]/.test(value) || value.includes('\\'))
}

function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  const pathOps = usesWindowsPaths(rootDir, candidatePath)
    ? win32
    : { resolve, relative, isAbsolute }

  const normalizedRoot = pathOps.resolve(rootDir)
  const normalizedTarget = pathOps.resolve(candidatePath)
  const relativeTarget = pathOps.relative(normalizedRoot, normalizedTarget)

  return relativeTarget === '' || (!relativeTarget.startsWith('..') && !pathOps.isAbsolute(relativeTarget))
}

export function assertPathInsideRoot(rootDir: string, candidatePath: string, message = 'Archive entry escapes target directory') {
  if (!isPathInsideRoot(rootDir, candidatePath)) {
    throw new Error(message)
  }
}

export function writeArchiveEntries(rootDir: string, entries: ArchiveEntry[]): void {
  for (const entry of entries) {
    const destPath = resolve(rootDir, entry.relativePath)
    assertPathInsideRoot(rootDir, destPath)
    mkdirSync(dirname(destPath), { recursive: true })
    writeFileSync(destPath, entry.content)
  }
}
