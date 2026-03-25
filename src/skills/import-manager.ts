import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, posix as posixPath, resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { parseFrontmatter } from './frontmatter.ts'
import { SkillsInstaller } from './installer.ts'
import {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRY_BYTES,
  MAX_ARCHIVE_ENTRY_COUNT,
  type ArchiveEntry,
  writeArchiveEntries,
} from './archive.ts'

export type ImportProviderId = 'raw-url' | 'github'

type GitHubTargetKind = 'repo-root' | 'directory' | 'skill-file'

export interface ImportProviderInfo {
  id: ImportProviderId
  label: string
  description: string
  capabilities: {
    probe: boolean
    singleFile: boolean
    directoryTree: boolean
    auth: 'none' | 'optional' | 'required'
  }
}

export interface ImportProbeResult {
  provider: ImportProviderId
  ok: boolean
  suggestedName?: string
  summary?: string
  metadata?: Record<string, unknown>
}

export interface RawUrlImportInput {
  url: string
  targetDir?: string
}

export interface GitHubImportInput {
  repoUrl: string
  path?: string
  ref?: string
  targetDir?: string
}

interface ImportContext {
  installer: SkillsInstaller
  targetDir: string
}

interface ImportProvider<Input> {
  info: ImportProviderInfo
  probe(input: Input): Promise<ImportProbeResult>
  import(input: Input, context: ImportContext): Promise<void>
}

interface ParsedGitHubUrl {
  owner: string
  repo: string
  ref?: string
  path?: string
  kind: GitHubTargetKind
}

interface GitHubResolvedTarget {
  owner: string
  repo: string
  ref?: string
  path?: string
  kind: GitHubTargetKind
  canonicalUrl: string
  skillFilePath: string
  skillRootPath?: string
}

interface GitHubDirectoryEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
  downloadUrl?: string | null
}

interface GitHubFileEntry {
  name: string
  path: string
  type: 'file'
  size: number
  downloadUrl?: string | null
  encoding?: string
  content?: string
}

const GITHUB_SKILL_FILE_NAME = 'SKILL.md'
const GITHUB_WEB_HOSTS = new Set(['github.com', 'www.github.com'])
const GITHUB_RAW_HOSTS = new Set(['raw.githubusercontent.com'])

class RawUrlImportProvider implements ImportProvider<RawUrlImportInput> {
  readonly info: ImportProviderInfo = {
    id: 'raw-url',
    label: 'Raw URL',
    description: 'Import a single remote SKILL.md file by URL.',
    capabilities: {
      probe: true,
      singleFile: true,
      directoryTree: false,
      auth: 'none',
    },
  }

  async probe(input: RawUrlImportInput): Promise<ImportProbeResult> {
    const response = await fetch(input.url)
    if (!response.ok) {
      throw new Error(`Remote import probe failed: HTTP ${response.status} ${response.statusText}`)
    }

    const content = await response.text()
    const { frontmatter } = parseFrontmatter(content)
    return {
      provider: 'raw-url',
      ok: true,
      suggestedName: frontmatter.name,
      summary: frontmatter.description,
      metadata: { url: input.url },
    }
  }

  async import(input: RawUrlImportInput, context: ImportContext): Promise<void> {
    await context.installer.installFromUrl(input.url, context.targetDir, {
      source: 'raw-url',
      sourceUrl: input.url,
      provider: 'raw-url',
      projectOrigin: 'imported',
    })
  }
}

class GitHubImportProvider implements ImportProvider<GitHubImportInput> {
  readonly info: ImportProviderInfo = {
    id: 'github',
    label: 'GitHub',
    description: 'Import a skill from a GitHub skill directory or SKILL.md file.',
    capabilities: {
      probe: true,
      singleFile: true,
      directoryTree: true,
      auth: 'none',
    },
  }

  async probe(input: GitHubImportInput): Promise<ImportProbeResult> {
    const target = this.resolveGitHubTarget(input)
    const content = await this.fetchSkillMarkdown(target)
    const { frontmatter } = parseFrontmatter(content)

    return {
      provider: 'github',
      ok: true,
      suggestedName: frontmatter.name,
      summary: frontmatter.description,
      metadata: {
        targetKind: target.kind,
        owner: target.owner,
        repo: target.repo,
        ref: target.ref ?? null,
        path: target.path ?? '',
        canonicalUrl: target.canonicalUrl,
      },
    }
  }

  async import(input: GitHubImportInput, context: ImportContext): Promise<void> {
    const target = this.resolveGitHubTarget(input)
    const probe = await this.probe(input)

    if (target.kind === 'skill-file') {
      const stageRoot = mkdtempSync(resolve(tmpdir(), 'youclaw-github-import-'))
      const skillDirName = probe.suggestedName || basename(target.skillRootPath ?? target.repo)
      const skillRoot = resolve(stageRoot, skillDirName)
      mkdirSync(skillRoot, { recursive: true })

      try {
        writeArchiveEntries(skillRoot, [{
          archivePath: target.skillFilePath,
          relativePath: GITHUB_SKILL_FILE_NAME,
          content: Buffer.from(await this.fetchSkillMarkdown(target), 'utf-8'),
        }])
        await context.installer.installFromLocal(skillRoot, context.targetDir, {
          source: 'github',
          slug: skillDirName,
          displayName: probe.suggestedName || skillDirName,
          provider: 'github',
          sourceUrl: target.canonicalUrl,
          ref: target.ref,
          path: target.path,
          projectOrigin: 'imported',
        })
        getLogger().info({ repoUrl: input.repoUrl, path: target.path, ref: target.ref }, 'Skill imported from GitHub file')
      } finally {
        rmSync(stageRoot, { recursive: true, force: true })
      }
      return
    }

    const archiveEntries = await this.fetchSkillDirectoryEntries(target)
    if (!archiveEntries.some((entry) => entry.relativePath === GITHUB_SKILL_FILE_NAME)) {
      throw new Error('Selected GitHub location is not a skill directory')
    }

    const stageRoot = mkdtempSync(resolve(tmpdir(), 'youclaw-github-import-'))
    const skillDirName = probe.suggestedName || basename(target.skillRootPath ?? target.repo)
    const skillRoot = resolve(stageRoot, skillDirName)
    mkdirSync(skillRoot, { recursive: true })

    try {
      writeArchiveEntries(skillRoot, archiveEntries)
      await context.installer.installFromLocal(skillRoot, context.targetDir, {
        source: 'github',
        slug: skillDirName,
        displayName: probe.suggestedName || skillDirName,
        provider: 'github',
        sourceUrl: target.canonicalUrl,
        ref: target.ref,
        path: target.path,
        projectOrigin: 'imported',
      })
      getLogger().info({ repoUrl: input.repoUrl, path: target.path, ref: target.ref }, 'Skill imported from GitHub directory')
    } finally {
      rmSync(stageRoot, { recursive: true, force: true })
    }
  }

  private resolveGitHubTarget(input: GitHubImportInput): GitHubResolvedTarget {
    const parsed = this.parseGitHubUrl(input.repoUrl)
    const ref = input.ref?.trim() || parsed.ref
    const hasPathOverride = input.path !== undefined
    const path = hasPathOverride
      ? normalizeImportPath(input.path)
      : normalizeImportPath(parsed.path)
    const kind = resolveTargetKind(parsed.kind, path, hasPathOverride)

    if (kind === 'skill-file' && !isSkillMarkdownPath(path)) {
      throw new Error('Selected GitHub file must be SKILL.md')
    }

    const skillFilePath = kind === 'skill-file'
      ? path!
      : path
        ? `${path}/${GITHUB_SKILL_FILE_NAME}`
        : GITHUB_SKILL_FILE_NAME

    const skillRootPath = kind === 'skill-file'
      ? normalizeImportPath(posixPath.dirname(skillFilePath))
      : path

    return {
      owner: parsed.owner,
      repo: parsed.repo,
      ref,
      path,
      kind,
      canonicalUrl: buildCanonicalGitHubUrl(parsed.owner, parsed.repo, ref, path, kind),
      skillFilePath,
      skillRootPath,
    }
  }

  private parseGitHubUrl(rawUrl: string): ParsedGitHubUrl {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw new Error('GitHub import requires a valid GitHub URL')
    }

    if (GITHUB_RAW_HOSTS.has(url.hostname)) {
      return this.parseRawGitHubUrl(url)
    }

    if (!GITHUB_WEB_HOSTS.has(url.hostname)) {
      throw new Error('GitHub import currently supports github.com and raw.githubusercontent.com URLs only')
    }

    const segments = splitUrlSegments(url.pathname)
    if (segments.length < 2) {
      throw new Error('GitHub import requires a URL like https://github.com/owner/repo')
    }

    const owner = segments[0]
    const repoSegment = segments[1]
    const action = segments[2]
    const rest = segments.slice(3)
    const repo = repoSegment?.replace(/\.git$/, '')
    if (!owner || !repo) {
      throw new Error('GitHub import requires a URL like https://github.com/owner/repo')
    }

    if (!action) {
      return { owner, repo, kind: 'repo-root' }
    }

    if (action === 'tree') {
      if (rest.length < 1) {
        throw new Error('GitHub tree URLs must include a branch, tag, or commit')
      }
      const treeRef = rest[0]
      if (!treeRef) {
        throw new Error('GitHub tree URLs must include a branch, tag, or commit')
      }
      return {
        owner,
        repo,
        ref: decodeURIComponent(treeRef),
        path: normalizeImportPath(rest.slice(1).join('/')),
        kind: rest.length > 1 ? 'directory' : 'repo-root',
      }
    }

    if (action === 'blob') {
      if (rest.length < 2) {
        throw new Error('GitHub blob URLs must point to a file path')
      }
      const blobRef = rest[0]
      if (!blobRef) {
        throw new Error('GitHub blob URLs must point to a file path')
      }
      return {
        owner,
        repo,
        ref: decodeURIComponent(blobRef),
        path: normalizeImportPath(rest.slice(1).join('/')),
        kind: 'skill-file',
      }
    }

    throw new Error('Unsupported GitHub URL format')
  }

  private parseRawGitHubUrl(url: URL): ParsedGitHubUrl {
    const segments = splitUrlSegments(url.pathname)
    if (segments.length < 4) {
      throw new Error('GitHub raw URLs must point to a SKILL.md file')
    }

    const owner = segments[0]
    const repo = segments[1]
    let refSegments: string[]
    let pathSegments: string[]

    if (segments[2] === 'refs' && (segments[3] === 'heads' || segments[3] === 'tags')) {
      if (segments.length < 6) {
        throw new Error('GitHub raw URLs must point to a SKILL.md file')
      }
      refSegments = [segments[4]!]
      pathSegments = segments.slice(5)
    } else {
      refSegments = [segments[2]!]
      pathSegments = segments.slice(3)
    }

    const ref = refSegments.join('/')
    if (!owner || !repo || !ref) {
      throw new Error('GitHub raw URLs must point to a SKILL.md file')
    }
    return {
      owner,
      repo,
      ref: decodeURIComponent(ref),
      path: normalizeImportPath(pathSegments.join('/')),
      kind: 'skill-file',
    }
  }

  private async fetchSkillMarkdown(target: GitHubResolvedTarget): Promise<string> {
    const fileEntry = await this.fetchSkillFileEntry(target)
    return this.readFileText(fileEntry)
  }

  private async fetchSkillFileEntry(target: GitHubResolvedTarget): Promise<GitHubFileEntry> {
    if (target.kind === 'skill-file') {
      const fileEntry = await this.fetchFileEntry(target.owner, target.repo, target.skillFilePath, target.ref)
      if (fileEntry.name !== GITHUB_SKILL_FILE_NAME) {
        throw new Error('Selected GitHub file must be SKILL.md')
      }
      return fileEntry
    }

    const listing = await this.fetchDirectoryListing(target.owner, target.repo, target.skillRootPath, target.ref)
    const skillFile = listing.find((entry) => entry.type === 'file' && entry.name === GITHUB_SKILL_FILE_NAME)
    if (!skillFile) {
      throw new Error('Selected GitHub location is not a skill directory')
    }
    return this.fetchFileEntry(target.owner, target.repo, skillFile.path, target.ref)
  }

  private async fetchSkillDirectoryEntries(target: GitHubResolvedTarget): Promise<ArchiveEntry[]> {
    const entries: ArchiveEntry[] = []
    let totalBytes = 0

    const walk = async (dirPath?: string) => {
      const listing = await this.fetchDirectoryListing(target.owner, target.repo, dirPath, target.ref)
      for (const entry of listing.sort(compareGitHubEntries)) {
        if (entry.type === 'dir') {
          await walk(entry.path)
          continue
        }

        if (entry.size > MAX_ARCHIVE_ENTRY_BYTES) {
          throw new Error(`Archive entry is too large: ${entry.path}`)
        }

        const content = await this.readFileBytes(entry)
        if (content.byteLength > MAX_ARCHIVE_ENTRY_BYTES) {
          throw new Error(`Archive entry is too large: ${entry.path}`)
        }

        totalBytes += content.byteLength
        if (totalBytes > MAX_ARCHIVE_BYTES) {
          throw new Error(`GitHub directory exceeds ${MAX_ARCHIVE_BYTES} bytes`)
        }

        entries.push({
          archivePath: entry.path,
          relativePath: toRelativeSkillPath(entry.path, target.skillRootPath),
          content,
        })

        if (entries.length > MAX_ARCHIVE_ENTRY_COUNT) {
          throw new Error(`Archive contains too many files (> ${MAX_ARCHIVE_ENTRY_COUNT})`)
        }
      }
    }

    await walk(target.skillRootPath)
    return entries
  }

  private async fetchDirectoryListing(owner: string, repo: string, path: string | undefined, ref: string | undefined): Promise<GitHubDirectoryEntry[]> {
    const payload = await this.fetchGitHubContents(owner, repo, path, ref)
    if (!Array.isArray(payload)) {
      throw new Error('GitHub import requires a repository or directory path, not a single file')
    }

    return payload
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .map((entry) => {
        const type = normalizeGitHubEntryType(entry.type)
        if (!type) {
          throw new Error(`Unsupported GitHub entry type at ${String(entry.path ?? entry.name ?? 'unknown')}`)
        }

        return {
          name: String(entry.name ?? ''),
          path: String(entry.path ?? ''),
          type,
          size: Number(entry.size ?? 0),
          downloadUrl: typeof entry.download_url === 'string' ? entry.download_url : null,
        }
      })
  }

  private async fetchFileEntry(owner: string, repo: string, filePath: string, ref: string | undefined): Promise<GitHubFileEntry> {
    const payload = await this.fetchGitHubContents(owner, repo, filePath, ref)
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      throw new Error('GitHub import requires a SKILL.md file at the selected path')
    }

    const type = normalizeGitHubEntryType('type' in payload ? payload.type : undefined)
    if (type !== 'file') {
      throw new Error('GitHub import requires a SKILL.md file at the selected path')
    }

    return {
      name: String('name' in payload ? payload.name : ''),
      path: String('path' in payload ? payload.path : filePath),
      type: 'file',
      size: Number('size' in payload ? payload.size : 0),
      downloadUrl: 'download_url' in payload && typeof payload.download_url === 'string' ? payload.download_url : null,
      encoding: 'encoding' in payload && typeof payload.encoding === 'string' ? payload.encoding : undefined,
      content: 'content' in payload && typeof payload.content === 'string' ? payload.content : undefined,
    }
  }

  private async fetchGitHubContents(owner: string, repo: string, path: string | undefined, ref: string | undefined): Promise<unknown> {
    const pathPart = path ? `/${path}` : ''
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents${pathPart}`)
    if (ref) {
      url.searchParams.set('ref', ref)
    }

    const response = await fetch(url, { headers: this.githubApiHeaders() })
    if (response.status === 404) {
      throw new Error('GitHub repository, ref, or path was not found')
    }
    if (!response.ok) {
      throw new Error(`GitHub request failed: HTTP ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<unknown>
  }

  private async readFileText(entry: GitHubFileEntry): Promise<string> {
    if (entry.encoding === 'base64' && entry.content) {
      return Buffer.from(entry.content.replace(/\n/g, ''), 'base64').toString('utf-8')
    }
    if (!entry.downloadUrl) {
      throw new Error(`GitHub file cannot be downloaded: ${entry.path}`)
    }

    const response = await fetch(entry.downloadUrl, { headers: this.githubDownloadHeaders() })
    if (!response.ok) {
      throw new Error(`GitHub file download failed: HTTP ${response.status} ${response.statusText}`)
    }
    return response.text()
  }

  private async readFileBytes(entry: GitHubDirectoryEntry | GitHubFileEntry): Promise<Uint8Array> {
    if ('encoding' in entry && entry.encoding === 'base64' && entry.content) {
      return Buffer.from(entry.content.replace(/\n/g, ''), 'base64')
    }
    if (!entry.downloadUrl) {
      throw new Error(`GitHub file cannot be downloaded: ${entry.path}`)
    }

    const response = await fetch(entry.downloadUrl, { headers: this.githubDownloadHeaders() })
    if (!response.ok) {
      throw new Error(`GitHub file download failed: HTTP ${response.status} ${response.statusText}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  private githubApiHeaders() {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'youclaw-importer',
    }
  }

  private githubDownloadHeaders() {
    return {
      'User-Agent': 'youclaw-importer',
    }
  }
}

export class ImportManager {
  private readonly rawUrlProvider = new RawUrlImportProvider()
  private readonly gitHubProvider = new GitHubImportProvider()

  constructor(private readonly installer: SkillsInstaller = new SkillsInstaller()) {}

  listProviders(): ImportProviderInfo[] {
    return [this.rawUrlProvider.info, this.gitHubProvider.info]
  }

  probe(provider: 'raw-url', input: RawUrlImportInput): Promise<ImportProbeResult>
  probe(provider: 'github', input: GitHubImportInput): Promise<ImportProbeResult>
  async probe(provider: ImportProviderId, input: RawUrlImportInput | GitHubImportInput): Promise<ImportProbeResult> {
    if (provider === 'raw-url') {
      return this.rawUrlProvider.probe(input as RawUrlImportInput)
    }
    return this.gitHubProvider.probe(input as GitHubImportInput)
  }

  import(provider: 'raw-url', input: RawUrlImportInput): Promise<void>
  import(provider: 'github', input: GitHubImportInput): Promise<void>
  async import(provider: ImportProviderId, input: RawUrlImportInput | GitHubImportInput): Promise<void> {
    const targetDir = resolveImportTarget(input.targetDir)
    const context: ImportContext = { installer: this.installer, targetDir }
    if (provider === 'raw-url') {
      await this.rawUrlProvider.import(input as RawUrlImportInput, context)
      return
    }
    await this.gitHubProvider.import(input as GitHubImportInput, context)
  }
}

function splitUrlSegments(pathname: string): string[] {
  return pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
}

function resolveTargetKind(parsedKind: GitHubTargetKind, path: string | undefined, hasPathOverride: boolean): GitHubTargetKind {
  if (!path) {
    return 'repo-root'
  }
  if (isSkillMarkdownPath(path)) {
    return 'skill-file'
  }
  if (!hasPathOverride && parsedKind === 'skill-file') {
    return 'skill-file'
  }
  return 'directory'
}

function isSkillMarkdownPath(path: string | undefined): path is string {
  if (!path) {
    return false
  }
  return posixPath.basename(path) === GITHUB_SKILL_FILE_NAME
}

function buildCanonicalGitHubUrl(owner: string, repo: string, ref: string | undefined, path: string | undefined, kind: GitHubTargetKind): string {
  const base = `https://github.com/${owner}/${repo}`
  if (!ref) {
    return path ? `${base}/${kind === 'skill-file' ? 'blob' : 'tree'}/HEAD/${path}` : base
  }
  if (!path) {
    return `${base}/tree/${encodeURIComponent(ref)}`
  }
  if (kind === 'skill-file') {
    return `${base}/blob/${encodeURIComponent(ref)}/${path}`
  }
  return `${base}/tree/${encodeURIComponent(ref)}/${path}`
}

function normalizeGitHubEntryType(value: unknown): 'file' | 'dir' | null {
  if (value === 'file' || value === 'dir') {
    return value
  }
  return null
}

function compareGitHubEntries(a: GitHubDirectoryEntry, b: GitHubDirectoryEntry): number {
  if (a.type !== b.type) {
    return a.type === 'dir' ? -1 : 1
  }
  return a.path.localeCompare(b.path)
}

function toRelativeSkillPath(entryPath: string, skillRootPath: string | undefined): string {
  const normalizedEntry = normalizeImportPath(entryPath)
  const normalizedRoot = normalizeImportPath(skillRootPath)
  if (!normalizedEntry) {
    throw new Error('GitHub entry has an empty path')
  }
  if (!normalizedRoot) {
    return normalizedEntry
  }
  if (normalizedEntry === normalizedRoot) {
    return ''
  }
  const prefix = `${normalizedRoot}/`
  if (!normalizedEntry.startsWith(prefix)) {
    throw new Error(`GitHub entry escaped selected directory: ${entryPath}`)
  }
  return normalizedEntry.slice(prefix.length)
}

function normalizeImportPath(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().replace(/^\/+|\/+$/g, '')
  return normalized || undefined
}

function resolveImportTarget(targetDir?: string): string {
  if (targetDir?.trim()) {
    return resolve(targetDir)
  }
  return getPaths().userSkills
}
