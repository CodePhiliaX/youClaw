import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { unzipSync } from 'fflate'
import { getLogger } from '../logger/index.ts'
import { parseFrontmatter } from './frontmatter.ts'
import type { SkillsLoader } from './loader.ts'
import type { SkillRegistryMeta } from './types.ts'
import recommendedSkillsData from './recommended-skills.json'

export type MarketplaceSort =
  | 'updated'
  | 'downloads'
  | 'stars'
  | 'installsCurrent'
  | 'installsAllTime'
  | 'trending'

export interface MarketplaceQuery {
  query?: string
  limit?: number
  cursor?: string | null
  sort?: MarketplaceSort
  highlightedOnly?: boolean
  nonSuspiciousOnly?: boolean
}

export interface MarketplaceSkill {
  slug: string
  displayName: string
  summary: string
  score?: number
  installed: boolean
  installedSkillName?: string
  installSource?: string
  installedVersion?: string
  latestVersion?: string | null
  hasUpdate: boolean
  createdAt?: number | null
  updatedAt?: number | null
  downloads?: number | null
  stars?: number | null
  installsCurrent?: number | null
  installsAllTime?: number | null
  tags: string[]
  category?: string
  source: 'clawhub' | 'fallback'
  metadata?: {
    os: string[]
    systems: string[]
  }
}

export interface MarketplaceSkillDetail extends MarketplaceSkill {
  ownerHandle?: string | null
  ownerDisplayName?: string | null
  ownerImage?: string | null
  moderation?: {
    isSuspicious: boolean
    isMalwareBlocked: boolean
    verdict: string
    summary?: string | null
  } | null
}

export interface MarketplacePage {
  items: MarketplaceSkill[]
  nextCursor: string | null
  source: 'clawhub' | 'fallback'
  query: string
  sort: MarketplaceSort
}

export interface RecommendedSkill extends MarketplaceSkill {}

interface RecommendedEntry {
  slug: string
  displayName: string
  summary: string
  category: string
}

interface RegistryManagerOptions {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  apiBaseUrl?: string
  downloadUrl?: string
  userSkillsDir?: string
}

interface NormalizedMarketplaceQuery {
  query: string
  limit: number
  cursor: string | null
  sort: MarketplaceSort
  highlightedOnly: boolean
  nonSuspiciousOnly: boolean
}

interface ClawHubSearchResult {
  score?: number
  slug?: string
  displayName?: string
  summary?: string | null
  version?: string | null
  updatedAt?: number
}

interface ClawHubSearchResponse {
  results?: ClawHubSearchResult[]
}

interface ClawHubSkillDetailResponse {
  skill?: {
    slug: string
    displayName: string
    summary?: string | null
    tags?: Record<string, string>
    stats?: unknown
    createdAt?: number
    updatedAt?: number
  } | null
  latestVersion?: {
    version?: string
    createdAt?: number
    changelog?: string
    license?: string | null
  } | null
  metadata?: {
    os?: string[] | null
    systems?: string[] | null
  } | null
  owner?: {
    handle?: string | null
    displayName?: string | null
    image?: string | null
  } | null
  moderation?: {
    isSuspicious?: boolean
    isMalwareBlocked?: boolean
    verdict?: string
    summary?: string | null
  } | null
}

interface MarketplaceStats {
  downloads: number | null
  stars: number | null
  installsCurrent: number | null
  installsAllTime: number | null
}

interface InstalledSkillState {
  slug: string
  installedSkillName?: string
  installSource?: string
  version?: string
}

const CLAWHUB_API_BASE = 'https://clawhub.ai/api/v1'
const CLAWHUB_DOWNLOAD_URL = `${CLAWHUB_API_BASE}/download`
const CLAWHUB_SEARCH_URL = `${CLAWHUB_API_BASE}/search`
const CLAWHUB_SOURCE = 'clawhub'
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024
const MAX_JSON_BYTES = 1024 * 1024
const MAX_ZIP_ENTRY_COUNT = 200
const MAX_ZIP_ENTRY_BYTES = 512 * 1024
const MAX_MARKETPLACE_LIMIT = 50
const DEFAULT_MARKETPLACE_LIMIT = 24
const FALLBACK_CURSOR_PREFIX = 'fallback:'
const SEARCH_CURSOR_PREFIX = 'search:'
const SEARCH_CACHE_TTL = 60_000

interface ZipEntry {
  archivePath: string
  relativePath: string
  content: Uint8Array
}

export class RegistryManager {
  private recommended: RecommendedEntry[] = []
  private searchCache: { query: string; allItems: MarketplaceSkill[]; fetchedAt: number } | null = null

  constructor(
    private skillsLoader: SkillsLoader,
    private options: RegistryManagerOptions = {},
  ) {
    this.loadRecommendedList()
  }

  /** Local fallback recommendations merged with install state */
  getRecommended(): RecommendedSkill[] {
    const installed = this.collectInstalledSkillStates()
    return this.recommended.map((entry) => this.buildFallbackSkill(entry, installed.get(entry.slug)))
  }

  /** Search ClawHub marketplace, merged with local install state */
  async searchSkills(query: string): Promise<RecommendedSkill[]> {
    const logger = getLogger()
    const url = `${this.resolveSearchUrl()}?q=${encodeURIComponent(query)}`

    logger.debug({ query, url }, 'Searching ClawHub marketplace')

    const response = await this.fetchImpl()(url)
    if (!response.ok) {
      throw new Error(`Search failed: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      results: Array<{
        slug: string
        displayName: string
        summary: string
        score?: number
        version?: string
        updatedAt?: string
      }>
    }
    const results = data.results ?? []

    const installed = this.collectInstalledSkillStates()

    // Merge install state
    return results.map((entry): RecommendedSkill => {
      const installedState = installed.get(entry.slug)
      return {
        slug: entry.slug,
        displayName: entry.displayName,
        summary: entry.summary,
        score: entry.score,
        installed: Boolean(installedState),
        installedSkillName: installedState?.installedSkillName,
        installSource: installedState?.installSource,
        installedVersion: installedState?.version,
        latestVersion: entry.version ?? null,
        updatedAt: entry.updatedAt ? Number(entry.updatedAt) || null : undefined,
        hasUpdate: false,
        tags: [],
        source: 'fallback',
      }
    })
  }

  async listMarketplace(query: MarketplaceQuery = {}): Promise<MarketplacePage> {
    const normalized = this.normalizeMarketplaceQuery(query)
    const installed = this.collectInstalledSkillStates()

    if (!normalized.query) {
      return this.listMarketplaceFallback(normalized, installed)
    }

    try {
      return await this.searchMarketplaceRemote(normalized, installed)
    } catch (error) {
      const logger = getLogger()
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(
        {
          query: normalized.query,
          sort: normalized.sort,
          cursor: normalized.cursor,
          error: message,
        },
        'Failed to load remote marketplace, falling back to local recommendations',
      )
      return this.listMarketplaceFallback(normalized, installed)
    }
  }

  async getMarketplaceSkill(slug: string): Promise<MarketplaceSkillDetail> {
    const normalizedSlug = slug.trim().toLowerCase()
    if (!normalizedSlug) {
      throw new Error('Missing slug')
    }

    const installed = this.collectInstalledSkillStates()

    try {
      return await this.fetchMarketplaceSkillDetail(normalizedSlug, installed)
    } catch (error) {
      const entry = this.recommended.find((item) => item.slug === normalizedSlug)
      if (!entry) {
        throw error
      }
      return this.buildFallbackSkill(entry, installed.get(entry.slug))
    }
  }

  /** Download a ZIP from ClawHub and install it into ~/.youclaw/skills/<slug>/ */
  async installSkill(slug: string): Promise<void> {
    const detail = await this.getMarketplaceSkill(slug)
    await this.installOrUpdateSkill(detail, 'install')
  }

  /** Update an installed ClawHub skill */
  async updateSkill(slug: string): Promise<void> {
    const normalizedSlug = slug.trim().toLowerCase()
    if (!normalizedSlug) {
      throw new Error('Missing slug')
    }

    const installed = this.readInstalledRegistryMeta(normalizedSlug)
    if (!installed) {
      throw new Error(`Skill "${normalizedSlug}" is not installed`)
    }
    if (installed.source !== CLAWHUB_SOURCE) {
      throw new Error(`Skill "${normalizedSlug}" was not installed from ClawHub`)
    }

    const detail = await this.getMarketplaceSkill(installed.slug)
    if (!detail.latestVersion) {
      throw new Error(`Unable to determine the latest version for "${installed.slug}"`)
    }
    if (installed.version && installed.version === detail.latestVersion) {
      throw new Error(`Skill "${installed.slug}" is already up to date`)
    }

    await this.installOrUpdateSkill(detail, 'update')
  }

  /** Uninstall a skill */
  async uninstallSkill(slug: string): Promise<void> {
    const logger = getLogger()
    const normalizedSlug = slug.trim().toLowerCase()
    if (!normalizedSlug) {
      throw new Error('Missing slug')
    }

    const userSkillsDir = this.resolveUserSkillsDir()
    const targetDir = resolve(userSkillsDir, normalizedSlug)

    if (!existsSync(targetDir)) {
      throw new Error(`Skill "${normalizedSlug}" is not installed`)
    }

    const meta = this.readRegistryMeta(targetDir)
    if (!meta || meta.source !== CLAWHUB_SOURCE || meta.slug !== normalizedSlug) {
      throw new Error(`Skill "${normalizedSlug}" was not installed from ClawHub`)
    }

    rmSync(targetDir, { recursive: true, force: true })

    this.skillsLoader.refresh()
    logger.info({ slug: normalizedSlug }, 'Skill uninstalled')
  }

  private async searchMarketplaceRemote(
    query: NormalizedMarketplaceQuery,
    installed: Map<string, InstalledSkillState>,
  ): Promise<MarketplacePage> {
    const offset = this.parseSearchCursor(query.cursor)

    // Fetch fresh results if no cache, query changed, or cache expired
    if (
      !this.searchCache ||
      this.searchCache.query !== query.query ||
      Date.now() - this.searchCache.fetchedAt > SEARCH_CACHE_TTL
    ) {
      const url = new URL(this.resolveSearchUrl())
      url.searchParams.set('q', query.query)
      url.searchParams.set('limit', String(MAX_MARKETPLACE_LIMIT))
      if (query.highlightedOnly) {
        url.searchParams.set('highlightedOnly', 'true')
      }
      if (query.nonSuspiciousOnly) {
        url.searchParams.set('nonSuspiciousOnly', 'true')
      }

      const payload = await this.fetchJson<ClawHubSearchResponse>(url.toString())
      const allItems = (payload.results ?? [])
        .filter((item): item is Required<Pick<ClawHubSearchResult, 'slug' | 'displayName'>> & ClawHubSearchResult => {
          return typeof item.slug === 'string' && item.slug.length > 0 && typeof item.displayName === 'string'
        })
        .map((item) => this.buildRemoteSearchSkill(item, installed.get(item.slug)))

      this.searchCache = {
        query: query.query,
        allItems,
        fetchedAt: Date.now(),
      }
    }

    const sliced = this.searchCache.allItems.slice(offset, offset + query.limit)
    const nextOffset = offset + query.limit
    const nextCursor = nextOffset < this.searchCache.allItems.length ? `${SEARCH_CURSOR_PREFIX}${nextOffset}` : null

    return {
      items: sliced,
      nextCursor,
      source: 'clawhub',
      query: query.query,
      sort: query.sort,
    }
  }

  private parseSearchCursor(cursor: string | null): number {
    if (!cursor || !cursor.startsWith(SEARCH_CURSOR_PREFIX)) {
      return 0
    }
    const value = Number.parseInt(cursor.slice(SEARCH_CURSOR_PREFIX.length), 10)
    return Number.isFinite(value) && value >= 0 ? value : 0
  }

  private listMarketplaceFallback(
    query: NormalizedMarketplaceQuery,
    installed: Map<string, InstalledSkillState>,
  ): MarketplacePage {
    const needle = query.query.toLowerCase()
    const filtered = this.recommended.filter((entry) => {
      if (!needle) return true
      return (
        entry.slug.toLowerCase().includes(needle) ||
        entry.displayName.toLowerCase().includes(needle) ||
        entry.summary.toLowerCase().includes(needle)
      )
    })

    const offset = this.parseFallbackCursor(query.cursor)
    const sliced = filtered
      .slice(offset, offset + query.limit)
      .map((entry) => this.buildFallbackSkill(entry, installed.get(entry.slug)))
    const nextOffset = offset + query.limit
    const nextCursor = nextOffset < filtered.length ? `${FALLBACK_CURSOR_PREFIX}${nextOffset}` : null

    return {
      items: sliced,
      nextCursor,
      source: 'fallback',
      query: query.query,
      sort: query.sort,
    }
  }

  private async fetchMarketplaceSkillDetail(
    slug: string,
    installed: Map<string, InstalledSkillState>,
  ): Promise<MarketplaceSkillDetail> {
    const url = `${this.resolveSkillDetailUrl()}/${encodeURIComponent(slug)}`
    const payload = await this.fetchJson<ClawHubSkillDetailResponse>(url)
    if (!payload.skill) {
      throw new Error(`Skill "${slug}" was not found`)
    }

    const latestVersion = payload.latestVersion?.version ?? this.resolveLatestVersion(payload.skill.tags)
    const installedState = installed.get(payload.skill.slug)
    const stats = this.normalizeStats(payload.skill.stats)
    const category = this.resolveCategory(payload.skill.slug, Object.keys(payload.skill.tags ?? {}))

    return {
      slug: payload.skill.slug,
      displayName: payload.skill.displayName,
      summary: payload.skill.summary ?? '',
      installed: Boolean(installedState),
      installedSkillName: installedState?.installedSkillName,
      installSource: installedState?.installSource,
      installedVersion: installedState?.version,
      latestVersion,
      hasUpdate: Boolean(installedState?.version && latestVersion && installedState.version !== latestVersion),
      createdAt: payload.skill.createdAt ?? null,
      updatedAt: payload.skill.updatedAt ?? null,
      downloads: stats.downloads,
      stars: stats.stars,
      installsCurrent: stats.installsCurrent,
      installsAllTime: stats.installsAllTime,
      tags: Object.keys(payload.skill.tags ?? {}),
      category,
      source: 'clawhub',
      metadata: this.normalizeMetadata(payload.metadata),
      ownerHandle: payload.owner?.handle ?? null,
      ownerDisplayName: payload.owner?.displayName ?? null,
      ownerImage: payload.owner?.image ?? null,
      moderation: payload.moderation
        ? {
            isSuspicious: Boolean(payload.moderation.isSuspicious),
            isMalwareBlocked: Boolean(payload.moderation.isMalwareBlocked),
            verdict: payload.moderation.verdict ?? 'clean',
            summary: payload.moderation.summary ?? null,
          }
        : null,
    }
  }

  private buildRemoteSearchSkill(
    item: Required<Pick<ClawHubSearchResult, 'slug' | 'displayName'>> & ClawHubSearchResult,
    installedState?: InstalledSkillState,
  ): MarketplaceSkill {
    const latestVersion = item.version ?? null
    return {
      slug: item.slug,
      displayName: item.displayName,
      summary: item.summary ?? '',
      installed: Boolean(installedState),
      installedSkillName: installedState?.installedSkillName,
      installSource: installedState?.installSource,
      installedVersion: installedState?.version,
      latestVersion,
      hasUpdate: Boolean(installedState?.version && latestVersion && installedState.version !== latestVersion),
      createdAt: null,
      updatedAt: item.updatedAt ?? null,
      downloads: null,
      stars: null,
      installsCurrent: null,
      installsAllTime: null,
      tags: [],
      category: this.resolveCategory(item.slug, []),
      source: 'clawhub',
    }
  }

  private buildFallbackSkill(
    entry: RecommendedEntry,
    installedState?: InstalledSkillState,
  ): MarketplaceSkillDetail {
    return {
      slug: entry.slug,
      displayName: entry.displayName,
      summary: entry.summary,
      installed: Boolean(installedState),
      installedSkillName: installedState?.installedSkillName,
      installSource: installedState?.installSource,
      installedVersion: installedState?.version,
      latestVersion: null,
      hasUpdate: false,
      createdAt: null,
      updatedAt: null,
      downloads: null,
      stars: null,
      installsCurrent: null,
      installsAllTime: null,
      tags: [],
      category: entry.category,
      source: 'fallback',
    }
  }

  private normalizeMetadata(
    metadata?: { os?: string[] | null; systems?: string[] | null } | null,
  ): MarketplaceSkill['metadata'] | undefined {
    if (!metadata) {
      return undefined
    }

    return {
      os: Array.isArray(metadata.os) ? metadata.os.map(String) : [],
      systems: Array.isArray(metadata.systems) ? metadata.systems.map(String) : [],
    }
  }

  private normalizeStats(stats: unknown): MarketplaceStats {
    const safe = stats && typeof stats === 'object' ? (stats as Record<string, unknown>) : {}
    return {
      downloads: this.readNumberStat(safe.downloads),
      stars: this.readNumberStat(safe.stars),
      installsCurrent: this.readNumberStat(safe.installsCurrent),
      installsAllTime: this.readNumberStat(safe.installsAllTime),
    }
  }

  private readNumberStat(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  private resolveLatestVersion(tags?: Record<string, string>): string | null {
    if (!tags) {
      return null
    }
    return typeof tags.latest === 'string' ? tags.latest : null
  }

  private resolveCategory(slug: string, tags: string[]): string | undefined {
    const recommended = this.recommended.find((entry) => entry.slug === slug)
    if (recommended) {
      return recommended.category
    }

    const normalized = tags.map((tag) => tag.toLowerCase())
    if (normalized.includes('agent')) return 'agent'
    if (normalized.includes('search')) return 'search'
    if (normalized.includes('browser')) return 'browser'
    if (normalized.includes('coding') || normalized.includes('code')) return 'coding'
    return undefined
  }

  private async installOrUpdateSkill(
    detail: MarketplaceSkillDetail,
    mode: 'install' | 'update',
  ): Promise<void> {
    const logger = getLogger()
    const slug = detail.slug
    const userSkillsDir = this.resolveUserSkillsDir()
    const targetDir = resolve(userSkillsDir, slug)
    const tempDir = resolve(
      userSkillsDir,
      `.tmp-${mode}-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    )
    const backupDir = resolve(
      userSkillsDir,
      `.bak-${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    )
    const shouldReplace = mode === 'update'

    if (mode === 'install' && existsSync(targetDir)) {
      throw new Error(`Skill "${slug}" is already installed`)
    }

    if (mode === 'update' && !existsSync(targetDir)) {
      throw new Error(`Skill "${slug}" is not installed`)
    }

    mkdirSync(userSkillsDir, { recursive: true })

    const zipBuffer = await this.downloadSkillArchive(slug)
    mkdirSync(tempDir, { recursive: true })

    let movedOldTarget = false

    try {
      this.writeArchiveToDirectory(tempDir, zipBuffer)

      const meta: SkillRegistryMeta = {
        source: CLAWHUB_SOURCE,
        slug,
        installedAt: new Date().toISOString(),
        displayName: detail.displayName,
        version: detail.latestVersion ?? undefined,
      }
      writeFileSync(resolve(tempDir, '.registry.json'), JSON.stringify(meta, null, 2))

      if (shouldReplace) {
        const currentMeta = this.readRegistryMeta(targetDir)
        if (!currentMeta || currentMeta.source !== CLAWHUB_SOURCE || currentMeta.slug !== slug) {
          throw new Error(`Skill "${slug}" was not installed from ClawHub`)
        }

        renameSync(targetDir, backupDir)
        movedOldTarget = true
      } else if (existsSync(targetDir)) {
        throw new Error(`Skill "${slug}" is already installed`)
      }

      renameSync(tempDir, targetDir)
      if (movedOldTarget) {
        rmSync(backupDir, { recursive: true, force: true })
      }

      this.skillsLoader.refresh()
      logger.info({ slug, mode, targetDir }, shouldReplace ? 'Skill update completed' : 'Skill install completed')
    } catch (error) {
      rmSync(tempDir, { recursive: true, force: true })

      if (movedOldTarget) {
        if (!existsSync(targetDir) && existsSync(backupDir)) {
          renameSync(backupDir, targetDir)
        } else {
          rmSync(backupDir, { recursive: true, force: true })
        }
      }

      throw error
    }
  }

  private writeArchiveToDirectory(tempDir: string, zipBuffer: ArrayBuffer): void {
    const entries = this.unpackSkillArchive(new Uint8Array(zipBuffer))
    const skillMd = entries.find((entry) => entry.relativePath === 'SKILL.md')
    if (!skillMd) {
      throw new Error('Archive does not contain a root SKILL.md')
    }

    for (const entryData of entries) {
      const destPath = resolve(tempDir, entryData.relativePath)
      this.assertPathInsideRoot(tempDir, destPath, 'Archive entry escapes target directory')
      mkdirSync(dirname(destPath), { recursive: true })
      writeFileSync(destPath, entryData.content)
    }

    const skillContent = Buffer.from(skillMd.content).toString('utf-8')
    parseFrontmatter(skillContent)
  }

  private resolveUserSkillsDir(): string {
    return this.options.userSkillsDir ?? resolve(homedir(), '.youclaw', 'skills')
  }

  private resolveSearchUrl(): string {
    return `${this.resolveApiBaseUrl()}/search`
  }

  private resolveSkillDetailUrl(): string {
    return `${this.resolveApiBaseUrl()}/skills`
  }

  private resolveDownloadUrl(): string {
    return this.options.downloadUrl ?? CLAWHUB_DOWNLOAD_URL
  }

  private resolveApiBaseUrl(): string {
    return this.options.apiBaseUrl ?? CLAWHUB_API_BASE
  }

  private fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? fetch
  }

  private async sleep(ms: number): Promise<void> {
    if (this.options.sleep) {
      await this.options.sleep(ms)
      return
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
  }

  private async downloadSkillArchive(slug: string): Promise<ArrayBuffer> {
    const logger = getLogger()
    const url = `${this.resolveDownloadUrl()}?slug=${encodeURIComponent(slug)}`
    logger.info({ slug, url }, 'Downloading skill from ClawHub')

    const response = await this.fetchWithRetry(url)
    if (!response.ok) {
      throw new Error(await this.buildHttpErrorMessage('Download failed', response))
    }

    const contentLength = Number(response.headers.get('content-length') || '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Download failed: archive exceeds ${MAX_DOWNLOAD_BYTES} bytes`)
    }

    const zipBuffer = await response.arrayBuffer()
    if (zipBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Download failed: archive exceeds ${MAX_DOWNLOAD_BYTES} bytes`)
    }

    return zipBuffer
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetchWithRetry(url, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(await this.buildHttpErrorMessage('Marketplace request failed', response))
    }

    const contentLength = Number(response.headers.get('content-length') || '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
      throw new Error(`Remote response exceeds ${MAX_JSON_BYTES} bytes`)
    }

    const text = await response.text()
    if (Buffer.byteLength(text, 'utf-8') > MAX_JSON_BYTES) {
      throw new Error(`Remote response exceeds ${MAX_JSON_BYTES} bytes`)
    }

    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error('Remote response is not valid JSON')
    }
  }

  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let response = await this.fetchImpl()(url, init)

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10)
      await this.sleep(Math.max(0, retryAfter) * 1000)
      response = await this.fetchImpl()(url, init)
    }

    return response
  }

  private async buildHttpErrorMessage(prefix: string, response: Response): Promise<string> {
    let detail = `${response.status} ${response.statusText}`.trim()
    try {
      const text = (await response.text()).trim()
      if (text) {
        detail = `${detail}: ${text}`
      }
    } catch {
      // ignore body parse failures
    }
    return `${prefix}: ${detail}`
  }

  private normalizeMarketplaceQuery(query: MarketplaceQuery): NormalizedMarketplaceQuery {
    const limit = Math.min(
      MAX_MARKETPLACE_LIMIT,
      Math.max(1, Math.trunc(query.limit ?? DEFAULT_MARKETPLACE_LIMIT)),
    )
    return {
      query: (query.query ?? '').trim(),
      limit,
      cursor: query.cursor ?? null,
      sort: query.sort ?? 'trending',
      highlightedOnly: Boolean(query.highlightedOnly),
      nonSuspiciousOnly: query.nonSuspiciousOnly ?? true,
    }
  }

  private collectInstalledSkillStates(): Map<string, InstalledSkillState> {
    const installed = new Map<string, InstalledSkillState>()

    const userSkillsDir = this.resolveUserSkillsDir()
    if (!existsSync(userSkillsDir)) {
      return installed
    }

    for (const entry of readdirSync(userSkillsDir)) {
      const skillDir = resolve(userSkillsDir, entry)
      try {
        if (!statSync(skillDir).isDirectory()) {
          continue
        }
      } catch {
        continue
      }

      const meta = this.readRegistryMeta(skillDir)
      if (!meta || meta.source !== CLAWHUB_SOURCE || !existsSync(resolve(skillDir, 'SKILL.md'))) {
        continue
      }

      installed.set(meta.slug, {
        slug: meta.slug,
        installedSkillName: this.readInstalledSkillName(skillDir),
        installSource: meta.source,
        version: meta.version,
      })
    }

    return installed
  }

  private readInstalledRegistryMeta(slug: string): SkillRegistryMeta | null {
    const skillDir = resolve(this.resolveUserSkillsDir(), slug)
    if (!existsSync(resolve(skillDir, 'SKILL.md'))) {
      return null
    }
    const meta = this.readRegistryMeta(skillDir)
    if (!meta || meta.source !== CLAWHUB_SOURCE || meta.slug !== slug) {
      return null
    }
    return meta
  }

  private readRegistryMeta(skillDir: string): SkillRegistryMeta | null {
    const filePath = resolve(skillDir, '.registry.json')
    if (!existsSync(filePath)) {
      return null
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<SkillRegistryMeta>
      if (
        typeof parsed.source === 'string' &&
        typeof parsed.slug === 'string' &&
        typeof parsed.installedAt === 'string' &&
        (parsed.displayName === undefined || typeof parsed.displayName === 'string') &&
        (parsed.version === undefined || typeof parsed.version === 'string')
      ) {
        return parsed as SkillRegistryMeta
      }
    } catch {
      // ignore invalid registry metadata
    }

    return null
  }

  private readInstalledSkillName(skillDir: string): string | undefined {
    const skillPath = resolve(skillDir, 'SKILL.md')
    if (!existsSync(skillPath)) {
      return undefined
    }

    try {
      const content = readFileSync(skillPath, 'utf-8')
      return parseFrontmatter(content).frontmatter.name
    } catch {
      return undefined
    }
  }

  private unpackSkillArchive(zipData: Uint8Array): ZipEntry[] {
    const files = unzipSync(zipData)
    const rawEntries = Object.entries(files)
      .filter(([filePath, content]) => !(filePath.endsWith('/') && content.length === 0))
      .map(([filePath, content]) => ({
        archivePath: filePath,
        segments: this.normalizeArchiveSegments(filePath),
        content,
      }))

    if (rawEntries.length === 0) {
      throw new Error('Archive is empty')
    }
    if (rawEntries.length > MAX_ZIP_ENTRY_COUNT) {
      throw new Error(`Archive contains too many files (>${MAX_ZIP_ENTRY_COUNT})`)
    }

    for (const entry of rawEntries) {
      if (entry.content.byteLength > MAX_ZIP_ENTRY_BYTES) {
        throw new Error(`Archive entry is too large: ${entry.archivePath}`)
      }
    }

    const hasRootFiles = rawEntries.some((entry) => entry.segments.length === 1)
    let stripPrefix: string | null = null

    if (!hasRootFiles) {
      const topLevelDirs = new Set(rawEntries.map((entry) => entry.segments[0]))
      if (topLevelDirs.size !== 1) {
        throw new Error('Archive contains multiple top-level skill roots')
      }
      stripPrefix = rawEntries[0]!.segments[0]!
    }

    return rawEntries.map((entry) => {
      const relativeSegments = stripPrefix ? entry.segments.slice(1) : entry.segments

      if (relativeSegments.length === 0) {
        throw new Error(`Archive contains an invalid file path: ${entry.archivePath}`)
      }

      return {
        archivePath: entry.archivePath,
        relativePath: relativeSegments.join('/'),
        content: entry.content,
      }
    })
  }

  private normalizeArchiveSegments(filePath: string): string[] {
    const normalized = filePath.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+/g, '/')
    if (!normalized) {
      throw new Error('Archive contains an empty file path')
    }
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
      throw new Error(`Archive contains an illegal file path: ${filePath}`)
    }

    const segments = normalized.split('/').filter(Boolean)
    if (segments.length === 0) {
      throw new Error(`Archive contains an illegal file path: ${filePath}`)
    }
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      throw new Error(`Archive contains an illegal file path: ${filePath}`)
    }

    return segments
  }

  private assertPathInsideRoot(rootDir: string, targetPath: string, message: string): void {
    const rootPrefix = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`
    if (targetPath !== rootDir && !targetPath.startsWith(rootPrefix)) {
      throw new Error(message)
    }
  }

  private parseFallbackCursor(cursor: string | null): number {
    if (!cursor) {
      return 0
    }
    if (!cursor.startsWith(FALLBACK_CURSOR_PREFIX)) {
      return 0
    }

    const value = Number.parseInt(cursor.slice(FALLBACK_CURSOR_PREFIX.length), 10)
    return Number.isFinite(value) && value >= 0 ? value : 0
  }

  /** Load the bundled recommendation list once at startup */
  private loadRecommendedList(): void {
    this.recommended = recommendedSkillsData
    getLogger().debug({ count: this.recommended.length }, 'Recommendation list loaded')
  }

}
