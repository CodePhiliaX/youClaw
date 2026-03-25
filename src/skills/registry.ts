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
import { resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { getSettings } from '../settings/manager.ts'
import { parseFrontmatter } from './frontmatter.ts'
import type { SkillsLoader } from './loader.ts'
import type { SkillRegistryMeta } from './types.ts'
import recommendedSkillsData from './recommended-skills.json'
import { MAX_ARCHIVE_BYTES, unpackZipArchive, writeArchiveEntries } from './archive.ts'

export type MarketplaceSort =
  | 'updated'
  | 'downloads'
  | 'stars'
  | 'installsCurrent'
  | 'installsAllTime'
  | 'trending'

export type MarketplaceCategory =
  | 'agent'
  | 'memory'
  | 'documents'
  | 'media'
  | 'productivity'
  | 'data'
  | 'security'
  | 'integrations'
  | 'coding'
  | 'other'
  | 'search'
  | 'browser'

export type RegistrySourceId = 'clawhub' | 'tencent' | 'fallback'
export type RegistrySelectableSource = Exclude<RegistrySourceId, 'fallback'>

export interface RegistrySourceInfo {
  id: RegistrySelectableSource
  label: string
  description: string
  capabilities: {
    search: boolean
    list: boolean
    detail: boolean
    download: boolean
    update: boolean
    auth: 'none' | 'optional' | 'required'
    cursorPagination: boolean
    sorts: MarketplaceSort[]
  }
}

export interface MarketplaceQuery {
  query?: string
  limit?: number
  cursor?: string | null
  sort?: MarketplaceSort
  highlightedOnly?: boolean
  nonSuspiciousOnly?: boolean
  source?: RegistrySelectableSource
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
  source: RegistrySourceId
  detailUrl?: string | null
  metadata?: {
    os: string[]
    systems: string[]
  }
  homepageUrl?: string | null
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
  source: RegistrySourceId
  query: string
  sort: MarketplaceSort
}

export interface RecommendedSkill extends MarketplaceSkill {}

interface RecommendedEntry {
  slug: string
  displayName: string
  summary: string
  category: Exclude<MarketplaceCategory, 'other' | 'search' | 'browser'>
  tags: string[]
}

const recommendedCategorySet = new Set<RecommendedEntry['category']>([
  'agent',
  'memory',
  'documents',
  'media',
  'productivity',
  'data',
  'security',
  'integrations',
  'coding',
])

interface RegistryManagerOptions {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  apiBaseUrl?: string
  downloadUrl?: string
  userSkillsDir?: string
  clawhubApiBaseUrl?: string
  clawhubDownloadUrl?: string
  clawhubEnabled?: boolean
  clawhubTokenGetter?: () => string | null | undefined
  tencentSearchUrl?: string
  tencentDownloadUrl?: string
  tencentIndexUrl?: string
  tencentEnabled?: boolean
}

interface ClawHubSourceConfig {
  enabled: boolean
  apiBaseUrl: string
  downloadUrl: string
}

interface TencentSourceConfig {
  enabled: boolean
  indexUrl: string
  searchUrl: string
  downloadUrl: string
}

interface NormalizedMarketplaceQuery {
  query: string
  limit: number
  cursor: string | null
  sort: MarketplaceSort
  highlightedOnly: boolean
  nonSuspiciousOnly: boolean
}

interface InstalledSkillState {
  slug: string
  installedSkillName?: string
  installSource?: string
  version?: string
}

interface MarketplaceStats {
  downloads: number | null
  stars: number | null
  installsCurrent: number | null
  installsAllTime: number | null
}

interface RegistrySource {
  info: RegistrySourceInfo
  list(query: NormalizedMarketplaceQuery, installed: Map<string, InstalledSkillState>): Promise<MarketplacePage>
  getDetail(slug: string, installed: Map<string, InstalledSkillState>): Promise<MarketplaceSkillDetail>
  download(slug: string): Promise<ArrayBuffer>
}

interface MarketplaceSourceQueryLayer<TSearchItem, TDetailPayload> {
  search(query: NormalizedMarketplaceQuery): Promise<TSearchItem[]>
  getDetail(slug: string): Promise<TDetailPayload>
  download(slug: string): Promise<ArrayBuffer>
}

interface MarketplaceSourceAdapterLayer<TSearchItem, TDetailPayload> {
  adaptSearchItem(item: TSearchItem, installedState?: InstalledSkillState): MarketplaceSkill
  adaptDetail(slug: string, payload: TDetailPayload, installedState?: InstalledSkillState): MarketplaceSkillDetail
}

interface SearchCache<TItem> {
  query: string
  items: TItem[]
  fetchedAt: number
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

interface ClawHubListSkill {
  slug?: string
  displayName?: string
  summary?: string | null
  tags?: Record<string, string>
  stats?: unknown
  createdAt?: number
  updatedAt?: number
  latestVersion?: {
    version?: string
    createdAt?: number
  } | null
  metadata?: {
    os?: string[] | null
    systems?: string[] | null
  } | null
}

interface ClawHubListResponse {
  items?: ClawHubListSkill[]
  nextCursor?: string | null
}

interface ClawHubSkillDetailResponse {
  skill?: ClawHubListSkill | null
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

interface TencentIndexItem {
  rank?: number
  slug?: string
  name?: string
  description?: string
  version?: string
  homepage?: string
  downloads?: number
  stars?: number
  score?: number
  categories?: string[]
}

interface TencentSearchResultItem {
  slug: string
  displayName: string
  summary: string
  score?: number
  version?: string | null
  updatedAt?: number | null
  downloads?: number | null
  stars?: number | null
  categories?: string[]
  homepage?: string | null
}

interface TencentDetailPayload {
  slug: string
  displayName: string
  summary: string
  score?: number
  version?: string | null
  updatedAt?: number | null
  downloads?: number | null
  stars?: number | null
  categories?: string[]
  homepage?: string | null
}

interface TencentIndexResponse {
  total?: number
  skills?: TencentIndexItem[]
}

const CLAWHUB_API_BASE = 'https://clawhub.ai/api/v1'
const CLAWHUB_DOWNLOAD_URL = `${CLAWHUB_API_BASE}/download`
const TENCENT_SEARCH_URL = 'https://lightmake.site/api/v1/search'
const TENCENT_DOWNLOAD_URL = 'https://lightmake.site/api/v1/download'
const TENCENT_INDEX_URL = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills.json'
const DEFAULT_MARKETPLACE_LIMIT = 24
const MAX_MARKETPLACE_LIMIT = 50
const MAX_JSON_BYTES = 1024 * 1024
const FALLBACK_CURSOR_PREFIX = 'fallback:'
const SEARCH_CURSOR_PREFIX = 'search:'
const TENCENT_CURSOR_PREFIX = 'tencent:'
const REMOTE_CACHE_TTL = 60_000
const DEFAULT_SORTS: MarketplaceSort[] = ['trending', 'updated', 'downloads', 'stars', 'installsCurrent', 'installsAllTime']

class RegistryHttpClient {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly sleepImpl: (ms: number) => Promise<void>,
  ) {}

  async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchWithRetry(url, init)
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

  async fetchBuffer(url: string, init?: RequestInit, prefix = 'Download failed'): Promise<ArrayBuffer> {
    const response = await this.fetchWithRetry(url, init)
    if (!response.ok) {
      throw new Error(await this.buildHttpErrorMessage(prefix, response))
    }

    const contentLength = Number(response.headers.get('content-length') || '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
      throw new Error(`${prefix}: archive exceeds ${MAX_ARCHIVE_BYTES} bytes`)
    }

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error(`${prefix}: archive exceeds ${MAX_ARCHIVE_BYTES} bytes`)
    }

    return buffer
  }

  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let attempt = 0
    let response = await this.fetchImpl(url, init)

    while (response.status === 429 && attempt < 2) {
      attempt += 1
      const delayMs = this.resolveRetryDelay(response, attempt)
      await this.sleepImpl(delayMs)
      response = await this.fetchImpl(url, init)
    }

    return response
  }

  private resolveRetryDelay(response: Response, attempt: number): number {
    const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10)
    if (Number.isFinite(retryAfter) && retryAfter >= 0) {
      return retryAfter * 1000
    }

    const absoluteReset = Number.parseInt(response.headers.get('x-ratelimit-reset') || '', 10)
    if (Number.isFinite(absoluteReset) && absoluteReset > 0) {
      return Math.max(0, absoluteReset * 1000 - Date.now())
    }

    const base = Math.min(8_000, 1000 * 2 ** attempt)
    const jitter = Math.round(Math.random() * 250)
    return base + jitter
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
}

class ClawHubQueryLayer implements MarketplaceSourceQueryLayer<ClawHubSearchResult, ClawHubSkillDetailResponse> {
  constructor(
    private readonly http: RegistryHttpClient,
    private readonly getConfig: () => ClawHubSourceConfig,
    private readonly tokenGetter: () => string | null | undefined,
  ) {}

  async search(query: NormalizedMarketplaceQuery): Promise<ClawHubSearchResult[]> {
    const { apiBaseUrl } = this.getConfig()
    const url = new URL(`${apiBaseUrl}/search`)
    url.searchParams.set('q', query.query)
    url.searchParams.set('limit', String(MAX_MARKETPLACE_LIMIT))
    if (query.highlightedOnly) {
      url.searchParams.set('highlightedOnly', 'true')
    }
    if (query.nonSuspiciousOnly) {
      url.searchParams.set('nonSuspiciousOnly', 'true')
    }

    const payload = await this.http.fetchJson<ClawHubSearchResponse>(url.toString(), this.authInit())
    return (payload.results ?? []).filter((item): item is Required<Pick<ClawHubSearchResult, 'slug' | 'displayName'>> & ClawHubSearchResult => {
      return typeof item.slug === 'string' && item.slug.length > 0 && typeof item.displayName === 'string'
    })
  }

  async getDetail(slug: string): Promise<ClawHubSkillDetailResponse> {
    const { apiBaseUrl } = this.getConfig()
    return this.http.fetchJson<ClawHubSkillDetailResponse>(`${apiBaseUrl}/skills/${encodeURIComponent(slug)}`, this.authInit())
  }

  async download(slug: string): Promise<ArrayBuffer> {
    const { downloadUrl } = this.getConfig()
    return this.http.fetchBuffer(`${downloadUrl}?slug=${encodeURIComponent(slug)}`, this.authInit())
  }

  private authInit(): RequestInit | undefined {
    const token = this.tokenGetter()?.trim()
    if (!token) {
      return undefined
    }
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    }
  }
}

class ClawHubAdapterLayer implements MarketplaceSourceAdapterLayer<ClawHubSearchResult, ClawHubSkillDetailResponse> {
  adaptSearchItem(item: ClawHubSearchResult, installedState?: InstalledSkillState): MarketplaceSkill {
    const slug = item.slug ?? ''
    return buildNormalizedMarketplaceSkill({
      slug,
      displayName: item.displayName ?? slug,
      summary: item.summary ?? '',
      score: item.score,
      installedState,
      latestVersion: item.version ?? null,
      updatedAt: item.updatedAt ?? null,
      tags: [],
      category: undefined,
      source: 'clawhub',
      detailUrl: null,
      homepageUrl: null,
    })
  }

  adaptDetail(slug: string, payload: ClawHubSkillDetailResponse, installedState?: InstalledSkillState): MarketplaceSkillDetail {
    if (!payload.skill?.slug || !payload.skill.displayName) {
      throw new Error(`Skill "${slug}" was not found`)
    }

    const tags = Object.keys(payload.skill.tags ?? {})
    const stats = normalizeStats(payload.skill.stats)
    const ownerHandle = payload.owner?.handle ?? null

    return buildNormalizedMarketplaceDetail({
      slug: payload.skill.slug,
      displayName: payload.skill.displayName,
      summary: payload.skill.summary ?? '',
      installedState,
      latestVersion: payload.latestVersion?.version ?? resolveLatestVersion(payload.skill.tags),
      createdAt: payload.skill.createdAt ?? null,
      updatedAt: payload.skill.updatedAt ?? null,
      downloads: stats.downloads,
      stars: stats.stars,
      installsCurrent: stats.installsCurrent,
      installsAllTime: stats.installsAllTime,
      tags,
      category: resolveCategory(payload.skill.slug, tags, []),
      source: 'clawhub',
      metadata: normalizeMetadata(payload.metadata),
      detailUrl: resolveClawHubDetailUrl(ownerHandle, payload.skill.slug),
      homepageUrl: null,
      ownerHandle,
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
    })
  }
}

class ClawHubSource implements RegistrySource {
  readonly info: RegistrySourceInfo = {
    id: 'clawhub',
    label: 'ClawHub',
    description: 'Official public ClawHub registry.',
    capabilities: {
      search: true,
      list: true,
      detail: true,
      download: true,
      update: true,
      auth: 'optional',
      cursorPagination: true,
      sorts: DEFAULT_SORTS,
    },
  }

  private searchCache: SearchCache<ClawHubSearchResult> | null = null
  private readonly queryLayer: ClawHubQueryLayer
  private readonly adapterLayer = new ClawHubAdapterLayer()

  constructor(
    http: RegistryHttpClient,
    getConfig: () => ClawHubSourceConfig,
    tokenGetter: () => string | null | undefined,
  ) {
    this.queryLayer = new ClawHubQueryLayer(http, getConfig, tokenGetter)
  }

  async list(query: NormalizedMarketplaceQuery, installed: Map<string, InstalledSkillState>): Promise<MarketplacePage> {
    const offset = parseOffsetCursor(query.cursor, SEARCH_CURSOR_PREFIX)

    if (!this.searchCache || this.searchCache.query !== query.query || Date.now() - this.searchCache.fetchedAt > REMOTE_CACHE_TTL) {
      this.searchCache = {
        query: query.query,
        items: await this.queryLayer.search(query),
        fetchedAt: Date.now(),
      }
    }

    const items = this.searchCache.items
      .slice(offset, offset + query.limit)
      .map((item) => this.adapterLayer.adaptSearchItem(item, installed.get(item.slug ?? '')))
    const nextOffset = offset + query.limit

    return {
      items,
      nextCursor: nextOffset < this.searchCache.items.length ? `${SEARCH_CURSOR_PREFIX}${nextOffset}` : null,
      source: 'clawhub',
      query: query.query,
      sort: query.sort,
    }
  }

  async getDetail(slug: string, installed: Map<string, InstalledSkillState>): Promise<MarketplaceSkillDetail> {
    const payload = await this.queryLayer.getDetail(slug)
    return this.adapterLayer.adaptDetail(slug, payload, installed.get(slug))
  }

  async download(slug: string): Promise<ArrayBuffer> {
    return this.queryLayer.download(slug)
  }
}

class TencentQueryLayer implements MarketplaceSourceQueryLayer<TencentSearchResultItem, TencentDetailPayload> {
  private indexCache: { items: TencentIndexItem[]; fetchedAt: number } | null = null

  constructor(
    private readonly http: RegistryHttpClient,
    private readonly getConfig: () => TencentSourceConfig,
  ) {}

  async search(query: NormalizedMarketplaceQuery): Promise<TencentSearchResultItem[]> {
    const { searchUrl } = this.getConfig()
    const url = new URL(searchUrl)
    url.searchParams.set('q', query.query)
    url.searchParams.set('limit', String(MAX_MARKETPLACE_LIMIT))
    const payload = await this.http.fetchJson<{
      results?: Array<{
        slug?: string
        displayName?: string
        summary?: string
        score?: number
        version?: string
        updatedAt?: number
        downloads?: number
        stars?: number
        categories?: string[]
        homepage?: string
      }>
    }>(url.toString(), {
      headers: { Accept: 'application/json' },
    })

    return (payload.results ?? [])
      .filter((item): item is {
        slug: string
        displayName: string
        summary?: string
        score?: number
        version?: string
        updatedAt?: number
        downloads?: number
        stars?: number
        categories?: string[]
        homepage?: string
      } => {
        return typeof item.slug === 'string' && item.slug.length > 0 && typeof item.displayName === 'string'
      })
      .map((item) => ({
        slug: item.slug,
        displayName: item.displayName,
        summary: item.summary ?? '',
        score: item.score,
        version: item.version ?? null,
        updatedAt: item.updatedAt ?? null,
        downloads: item.downloads ?? null,
        stars: item.stars ?? null,
        categories: Array.isArray(item.categories) ? item.categories.map(String) : [],
        homepage: item.homepage ?? null,
      }))
  }

  async getDetail(slug: string): Promise<TencentDetailPayload> {
    const matched = (await this.loadIndex()).find((item) => item.slug === slug)
    if (matched?.slug && matched.name) {
      return {
        slug: matched.slug,
        displayName: matched.name,
        summary: matched.description ?? '',
        score: matched.score,
        version: matched.version ?? null,
        updatedAt: null,
        downloads: matched.downloads ?? null,
        stars: matched.stars ?? null,
        categories: matched.categories ?? [],
        homepage: matched.homepage ?? null,
      }
    }

    const searchMatch = await this.searchExactSlug(slug)
    if (searchMatch) {
      return {
        slug: searchMatch.slug,
        displayName: searchMatch.displayName,
        summary: searchMatch.summary,
        score: searchMatch.score,
        version: searchMatch.version ?? null,
        updatedAt: searchMatch.updatedAt ?? null,
        downloads: searchMatch.downloads ?? null,
        stars: searchMatch.stars ?? null,
        categories: searchMatch.categories ?? [],
        homepage: searchMatch.homepage ?? null,
      }
    }

    throw new Error(`Skill "${slug}" was not found`)
  }

  async download(slug: string): Promise<ArrayBuffer> {
    const { downloadUrl } = this.getConfig()
    return this.http.fetchBuffer(`${downloadUrl}?slug=${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/zip,application/octet-stream,*/*' },
    }, 'Tencent archive download failed')
  }

  private async loadIndex(): Promise<TencentIndexItem[]> {
    if (this.indexCache && Date.now() - this.indexCache.fetchedAt <= REMOTE_CACHE_TTL) {
      return this.indexCache.items
    }

    const { indexUrl } = this.getConfig()
    const payload = await this.http.fetchJson<TencentIndexResponse>(indexUrl, {
      headers: { Accept: 'application/json' },
    })

    const items = (payload.skills ?? []).filter((item): item is TencentIndexItem => {
      return typeof item.slug === 'string' && item.slug.length > 0 && typeof item.name === 'string'
    })

    this.indexCache = {
      items,
      fetchedAt: Date.now(),
    }
    return items
  }

  private async searchExactSlug(slug: string): Promise<TencentSearchResultItem | null> {
    const results = await this.search({
      query: slug,
      limit: MAX_MARKETPLACE_LIMIT,
      cursor: null,
      sort: 'trending',
      highlightedOnly: false,
      nonSuspiciousOnly: true,
    })

    return results.find((item) => item.slug === slug) ?? null
  }
}

class TencentAdapterLayer implements MarketplaceSourceAdapterLayer<TencentSearchResultItem, TencentDetailPayload> {
  adaptSearchItem(item: TencentSearchResultItem, installedState?: InstalledSkillState): MarketplaceSkill {
    return buildNormalizedMarketplaceSkill({
      slug: item.slug,
      displayName: item.displayName,
      summary: item.summary,
      score: item.score,
      installedState,
      latestVersion: item.version ?? null,
      updatedAt: item.updatedAt ?? null,
      downloads: item.downloads ?? null,
      stars: item.stars ?? null,
      tags: [],
      category: undefined,
      source: 'tencent',
      detailUrl: null,
      homepageUrl: null,
    })
  }

  adaptDetail(slug: string, payload: TencentDetailPayload, installedState?: InstalledSkillState): MarketplaceSkillDetail {
    const normalizedSlug = payload.slug || slug

    return buildNormalizedMarketplaceDetail({
      slug: normalizedSlug,
      displayName: payload.displayName || normalizedSlug,
      summary: payload.summary ?? '',
      score: payload.score,
      installedState,
      latestVersion: payload.version ?? null,
      createdAt: null,
      updatedAt: payload.updatedAt ?? null,
      downloads: payload.downloads ?? null,
      stars: payload.stars ?? null,
      installsCurrent: null,
      installsAllTime: null,
      tags: [],
      category: resolveCategory(normalizedSlug, [], payload.categories ?? []),
      source: 'tencent',
      detailUrl: null,
      homepageUrl: null,
      ownerHandle: null,
      ownerDisplayName: null,
      ownerImage: null,
      moderation: null,
    })
  }
}

class TencentSource implements RegistrySource {
  readonly info: RegistrySourceInfo = {
    id: 'tencent',
    label: 'Tencent',
    description: 'Tencent SkillHub marketplace source.',
    capabilities: {
      search: true,
      list: true,
      detail: true,
      download: true,
      update: true,
      auth: 'none',
      cursorPagination: true,
      sorts: ['trending', 'downloads', 'stars'],
    },
  }

  private searchCache: SearchCache<TencentSearchResultItem> | null = null
  private readonly queryLayer: TencentQueryLayer
  private readonly adapterLayer = new TencentAdapterLayer()

  constructor(
    http: RegistryHttpClient,
    getConfig: () => TencentSourceConfig,
  ) {
    this.queryLayer = new TencentQueryLayer(http, getConfig)
  }

  async list(query: NormalizedMarketplaceQuery, installed: Map<string, InstalledSkillState>): Promise<MarketplacePage> {
    const offset = parseOffsetCursor(query.cursor, SEARCH_CURSOR_PREFIX)

    if (!this.searchCache || this.searchCache.query !== query.query || Date.now() - this.searchCache.fetchedAt > REMOTE_CACHE_TTL) {
      this.searchCache = {
        query: query.query,
        items: await this.queryLayer.search(query),
        fetchedAt: Date.now(),
      }
    }

    const items = this.searchCache.items
      .slice(offset, offset + query.limit)
      .map((item) => this.adapterLayer.adaptSearchItem(item, installed.get(item.slug)))
    const nextOffset = offset + query.limit

    return {
      items,
      nextCursor: nextOffset < this.searchCache.items.length ? `${SEARCH_CURSOR_PREFIX}${nextOffset}` : null,
      source: 'tencent',
      query: query.query,
      sort: query.sort,
    }
  }

  async getDetail(slug: string, installed: Map<string, InstalledSkillState>): Promise<MarketplaceSkillDetail> {
    const payload = await this.queryLayer.getDetail(slug)
    return this.adapterLayer.adaptDetail(slug, payload, installed.get(slug))
  }

  async download(slug: string): Promise<ArrayBuffer> {
    return this.queryLayer.download(slug)
  }
}

export class RegistryManager {
  private recommended: RecommendedEntry[] = []
  private readonly http: RegistryHttpClient
  private readonly sources: Map<RegistrySelectableSource, RegistrySource>

  constructor(
    private readonly skillsLoader: SkillsLoader,
    private readonly options: RegistryManagerOptions = {},
  ) {
    this.loadRecommendedList()
    this.http = new RegistryHttpClient(this.fetchImpl(), this.sleep.bind(this))
    this.sources = new Map<RegistrySelectableSource, RegistrySource>([
      ['clawhub', new ClawHubSource(this.http, () => this.resolveClawhubConfig(), () => this.resolveClawhubToken())],
      ['tencent', new TencentSource(this.http, () => this.resolveTencentConfig())],
    ])
  }

  listSources(): RegistrySourceInfo[] {
    return Array.from(this.sources.values()).map((source) => source.info)
  }

  getRecommended(): RecommendedSkill[] {
    const installed = this.collectInstalledSkillStates()
    return this.recommended.map((entry) => this.buildFallbackSkill(entry, installed.get(entry.slug)))
  }

  async searchSkills(query: string, sourceId: RegistrySelectableSource = 'clawhub'): Promise<RecommendedSkill[]> {
    if (!query.trim()) {
      return this.getRecommended()
    }
    const page = await this.listMarketplaceForSource(sourceId, { query, limit: MAX_MARKETPLACE_LIMIT })
    return page.items
  }

  async listMarketplace(query: MarketplaceQuery = {}): Promise<MarketplacePage> {
    const sourceId = query.source ?? 'clawhub'
    return this.listMarketplaceForSource(sourceId, query)
  }

  async listMarketplaceForSource(sourceId: RegistrySelectableSource, query: MarketplaceQuery = {}): Promise<MarketplacePage> {
    const installed = this.collectInstalledSkillStates()

    if (!(query.query ?? '').trim()) {
      const normalized = this.normalizeMarketplaceQuery(query, DEFAULT_SORTS)
      return this.listMarketplaceFallback(normalized, installed)
    }

    const source = this.requireSource(sourceId)
    const normalized = this.normalizeMarketplaceQuery(query, source.info.capabilities.sorts)

    if (!normalized.query) {
      return this.listMarketplaceFallback(normalized, installed)
    }

    try {
      return await source.list(normalized, installed)
    } catch (error) {
      const logger = getLogger()
      const message = error instanceof Error ? error.message : String(error)
      logger.warn({ source: sourceId, query: normalized.query, error: message }, 'Failed to load remote marketplace source')
      throw error
    }
  }

  async getMarketplaceSkill(slug: string, sourceId: RegistrySelectableSource = 'clawhub'): Promise<MarketplaceSkillDetail> {
    return this.getMarketplaceSkillForSource(sourceId, slug)
  }

  async getMarketplaceSkillForSource(sourceId: RegistrySelectableSource, slug: string): Promise<MarketplaceSkillDetail> {
    const normalizedSlug = slug.trim().toLowerCase()
    if (!normalizedSlug) {
      throw new Error('Missing slug')
    }

    return this.requireSource(sourceId).getDetail(normalizedSlug, this.collectInstalledSkillStates())
  }

  async installSkill(slug: string, sourceId: RegistrySelectableSource = 'clawhub'): Promise<void> {
    return this.installSkillFromSource(sourceId, slug)
  }

  async installSkillFromSource(sourceId: RegistrySelectableSource, slug: string): Promise<void> {
    const detail = await this.getMarketplaceSkillForSource(sourceId, slug)
    await this.installOrUpdateSkill(sourceId, detail, 'install')
  }

  async updateSkill(slug: string, sourceId: RegistrySelectableSource = 'clawhub'): Promise<void> {
    return this.updateSkillFromSource(sourceId, slug)
  }

  async updateSkillFromSource(sourceId: RegistrySelectableSource, slug: string): Promise<void> {
    const normalizedSlug = slug.trim().toLowerCase()
    if (!normalizedSlug) {
      throw new Error('Missing slug')
    }

    const sourceLabel = this.requireSource(sourceId).info.label
    const installed = this.readInstalledRegistryMeta(normalizedSlug)
    if (!installed) {
      throw new Error(`Skill "${normalizedSlug}" is not installed`)
    }
    if (installed.source !== sourceId) {
      throw new Error(`Skill "${normalizedSlug}" was not installed from ${sourceLabel}`)
    }

    const detail = await this.getMarketplaceSkillForSource(sourceId, installed.slug)
    if (!detail.latestVersion) {
      throw new Error(`Unable to determine the latest version for "${installed.slug}"`)
    }
    if (installed.version && installed.version === detail.latestVersion) {
      throw new Error(`Skill "${installed.slug}" is already up to date`)
    }

    await this.installOrUpdateSkill(sourceId, detail, 'update')
  }

  async uninstallSkill(slug: string, sourceId: RegistrySelectableSource = 'clawhub'): Promise<void> {
    return this.uninstallSkillFromSource(sourceId, slug)
  }

  async uninstallSkillFromSource(sourceId: RegistrySelectableSource, slug: string): Promise<void> {
    const normalizedSlug = slug.trim().toLowerCase()
    if (!normalizedSlug) {
      throw new Error('Missing slug')
    }

    const sourceLabel = this.requireSource(sourceId).info.label
    const userSkillsDir = this.resolveUserSkillsDir()
    const targetDir = resolve(userSkillsDir, normalizedSlug)

    if (!existsSync(targetDir)) {
      throw new Error(`Skill "${normalizedSlug}" is not installed`)
    }

    const meta = this.readRegistryMeta(targetDir)
    if (!meta || meta.source !== sourceId || meta.slug !== normalizedSlug) {
      throw new Error(`Skill "${normalizedSlug}" was not installed from ${sourceLabel}`)
    }

    rmSync(targetDir, { recursive: true, force: true })
    this.skillsLoader.refresh()
  }

  private async installOrUpdateSkill(
    sourceId: RegistrySelectableSource,
    detail: MarketplaceSkillDetail,
    mode: 'install' | 'update',
  ): Promise<void> {
    const userSkillsDir = this.resolveUserSkillsDir()
    const targetDir = resolve(userSkillsDir, detail.slug)
    const tempDir = resolve(userSkillsDir, `.tmp-${mode}-${detail.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
    const backupDir = resolve(userSkillsDir, `.bak-${detail.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
    const shouldReplace = mode === 'update'

    if (mode === 'install' && existsSync(targetDir)) {
      throw new Error(`Skill "${detail.slug}" is already installed`)
    }
    if (mode === 'update' && !existsSync(targetDir)) {
      throw new Error(`Skill "${detail.slug}" is not installed`)
    }

    mkdirSync(userSkillsDir, { recursive: true })

    const archive = await this.requireSource(sourceId).download(detail.slug)
    mkdirSync(tempDir, { recursive: true })
    let movedOldTarget = false

    try {
      const entries = unpackZipArchive(new Uint8Array(archive))
      const skillEntry = entries.find((entry) => entry.relativePath === 'SKILL.md')
      if (!skillEntry) {
        throw new Error('Archive does not contain a root SKILL.md')
      }

      writeArchiveEntries(tempDir, entries)
      parseFrontmatter(readFileSync(resolve(tempDir, 'SKILL.md'), 'utf-8'))

      const meta: SkillRegistryMeta = {
        source: sourceId,
        slug: detail.slug,
        installedAt: new Date().toISOString(),
        displayName: detail.displayName,
        version: detail.latestVersion ?? undefined,
        homepageUrl: detail.homepageUrl ?? undefined,
      }
      writeFileSync(resolve(tempDir, '.registry.json'), JSON.stringify(meta, null, 2), 'utf-8')

      if (shouldReplace) {
        const currentMeta = this.readRegistryMeta(targetDir)
        if (!currentMeta || currentMeta.source !== sourceId || currentMeta.slug !== detail.slug) {
          throw new Error(`Skill "${detail.slug}" was not installed from ${this.requireSource(sourceId).info.label}`)
        }
        renameSync(targetDir, backupDir)
        movedOldTarget = true
      }

      renameSync(tempDir, targetDir)
      if (movedOldTarget) {
        rmSync(backupDir, { recursive: true, force: true })
      }

      this.skillsLoader.refresh()
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
        entry.summary.toLowerCase().includes(needle) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(needle))
      )
    })

    const offset = parseOffsetCursor(query.cursor, FALLBACK_CURSOR_PREFIX)
    const items = filtered
      .slice(offset, offset + query.limit)
      .map((entry) => this.buildFallbackSkill(entry, installed.get(entry.slug)))
    const nextOffset = offset + query.limit

    return {
      items,
      nextCursor: nextOffset < filtered.length ? `${FALLBACK_CURSOR_PREFIX}${nextOffset}` : null,
      source: 'fallback',
      query: query.query,
      sort: query.sort,
    }
  }

  private buildFallbackSkill(entry: RecommendedEntry, installedState?: InstalledSkillState): MarketplaceSkillDetail {
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
      tags: entry.tags,
      category: entry.category,
      source: 'fallback',
      detailUrl: null,
      homepageUrl: null,
      ownerHandle: null,
      ownerDisplayName: null,
      ownerImage: null,
      moderation: null,
    }
  }

  private normalizeMarketplaceQuery(query: MarketplaceQuery, supportedSorts: MarketplaceSort[]): NormalizedMarketplaceQuery {
    const requestedSort = query.sort ?? 'trending'
    const sort = supportedSorts.includes(requestedSort) ? requestedSort : supportedSorts[0] ?? 'trending'
    const limit = Math.min(MAX_MARKETPLACE_LIMIT, Math.max(1, Math.trunc(query.limit ?? DEFAULT_MARKETPLACE_LIMIT)))

    return {
      query: (query.query ?? '').trim(),
      limit,
      cursor: query.cursor ?? null,
      sort,
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
        if (!statSync(skillDir).isDirectory()) continue
      } catch {
        continue
      }

      const meta = this.readRegistryMeta(skillDir)
      if (!meta || !existsSync(resolve(skillDir, 'SKILL.md'))) {
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
    if (!meta || meta.slug !== slug) {
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
      if (typeof parsed.source === 'string' && typeof parsed.slug === 'string' && typeof parsed.installedAt === 'string') {
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

  private requireSource(sourceId: RegistrySelectableSource): RegistrySource {
    const source = this.sources.get(sourceId)
    if (!source) {
      throw new Error(`Unknown registry source: ${sourceId}`)
    }
    return source
  }

  private resolveClawhubConfig(): ClawHubSourceConfig {
    const settings = this.readRegistrySourceSettings()?.clawhub
    return {
      enabled: this.options.clawhubEnabled ?? settings?.enabled ?? true,
      apiBaseUrl: this.options.clawhubApiBaseUrl ?? this.options.apiBaseUrl ?? settings?.apiBaseUrl ?? CLAWHUB_API_BASE,
      downloadUrl: this.options.clawhubDownloadUrl ?? this.options.downloadUrl ?? settings?.downloadUrl ?? CLAWHUB_DOWNLOAD_URL,
    }
  }

  private resolveClawhubToken(): string {
    return this.options.clawhubTokenGetter?.() ?? this.readRegistrySourceSettings()?.clawhub.token ?? ''
  }

  private resolveTencentConfig(): TencentSourceConfig {
    const settings = this.readRegistrySourceSettings()?.tencent
    return {
      enabled: this.options.tencentEnabled ?? settings?.enabled ?? true,
      indexUrl: this.options.tencentIndexUrl ?? settings?.indexUrl ?? TENCENT_INDEX_URL,
      searchUrl: this.options.tencentSearchUrl ?? settings?.searchUrl ?? TENCENT_SEARCH_URL,
      downloadUrl: this.options.tencentDownloadUrl ?? settings?.downloadUrl ?? TENCENT_DOWNLOAD_URL,
    }
  }

  private resolveUserSkillsDir(): string {
    return this.options.userSkillsDir ?? getPaths().userSkills
  }

  private loadRecommendedList(): void {
    this.recommended = recommendedSkillsData.flatMap((entry) => {
      if (!recommendedCategorySet.has(entry.category as RecommendedEntry['category'])) {
        getLogger().warn({ slug: entry.slug, category: entry.category }, 'Skipping recommended skill with unsupported category')
        return []
      }
      return [{
        slug: entry.slug,
        displayName: entry.displayName,
        summary: entry.summary,
        category: entry.category as RecommendedEntry['category'],
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
      }]
    })
    getLogger().debug({ count: this.recommended.length }, 'Recommendation list loaded')
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

  private readRegistrySourceSettings() {
    try {
      return getSettings().registrySources
    } catch {
      return null
    }
  }
}

interface NormalizedMarketplaceSkillInput {
  slug: string
  displayName: string
  summary: string
  source: RegistrySourceId
  installedState?: InstalledSkillState
  score?: number
  latestVersion?: string | null
  createdAt?: number | null
  updatedAt?: number | null
  downloads?: number | null
  stars?: number | null
  installsCurrent?: number | null
  installsAllTime?: number | null
  tags: string[]
  category?: string
  metadata?: {
    os: string[]
    systems: string[]
  }
  detailUrl?: string | null
  homepageUrl?: string | null
}

interface NormalizedMarketplaceDetailInput extends NormalizedMarketplaceSkillInput {
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

function buildNormalizedMarketplaceSkill(input: NormalizedMarketplaceSkillInput): MarketplaceSkill {
  const latestVersion = input.latestVersion ?? null
  const installedVersion = input.installedState?.version

  return {
    slug: input.slug,
    displayName: input.displayName,
    summary: input.summary,
    score: input.score,
    installed: Boolean(input.installedState),
    installedSkillName: input.installedState?.installedSkillName,
    installSource: input.installedState?.installSource,
    installedVersion,
    latestVersion,
    hasUpdate: Boolean(installedVersion && latestVersion && installedVersion !== latestVersion),
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null,
    downloads: input.downloads ?? null,
    stars: input.stars ?? null,
    installsCurrent: input.installsCurrent ?? null,
    installsAllTime: input.installsAllTime ?? null,
    tags: input.tags,
    category: input.category,
    source: input.source,
    detailUrl: input.detailUrl ?? null,
    metadata: input.metadata,
    homepageUrl: input.homepageUrl ?? null,
  }
}

function buildNormalizedMarketplaceDetail(input: NormalizedMarketplaceDetailInput): MarketplaceSkillDetail {
  return {
    ...buildNormalizedMarketplaceSkill(input),
    ownerHandle: input.ownerHandle ?? null,
    ownerDisplayName: input.ownerDisplayName ?? null,
    ownerImage: input.ownerImage ?? null,
    moderation: input.moderation ?? null,
  }
}

function parseOffsetCursor(cursor: string | null, prefix: string): number {
  if (!cursor || !cursor.startsWith(prefix)) {
    return 0
  }
  const value = Number.parseInt(cursor.slice(prefix.length), 10)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function normalizeStats(stats: unknown): MarketplaceStats {
  const safe = stats && typeof stats === 'object' ? (stats as Record<string, unknown>) : {}
  return {
    downloads: readNumberStat(safe.downloads),
    stars: readNumberStat(safe.stars),
    installsCurrent: readNumberStat(safe.installsCurrent),
    installsAllTime: readNumberStat(safe.installsAllTime),
  }
}

function normalizeMetadata(metadata?: { os?: string[] | null; systems?: string[] | null } | null) {
  if (!metadata) {
    return undefined
  }

  return {
    os: Array.isArray(metadata.os) ? metadata.os.map(String) : [],
    systems: Array.isArray(metadata.systems) ? metadata.systems.map(String) : [],
  }
}

function readNumberStat(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function resolveLatestVersion(tags?: Record<string, string>): string | null {
  if (!tags) {
    return null
  }
  return typeof tags.latest === 'string' ? tags.latest : null
}

function resolveClawHubDetailUrl(ownerHandle?: string | null, slug?: string | null): string | null {
  if (!ownerHandle || !slug) {
    return null
  }
  return `https://clawhub.ai/${ownerHandle}/${slug}`
}

function resolveCategory(slug: string, tags: string[], categories: string[]): string | undefined {
  const category = normalizeSourceCategory(categories[0])
  if (category) {
    return category
  }

  const normalized = tags.map((tag) => tag.toLowerCase())
  if (normalized.some((tag) => ['memory', 'notes', 'knowledge', 'knowledge-base'].includes(tag))) return 'memory'
  if (normalized.some((tag) => ['pdf', 'document', 'documents', 'summary', 'summarization'].includes(tag))) return 'documents'
  if (normalized.some((tag) => ['media', 'audio', 'video', 'image', 'speech', 'transcription'].includes(tag))) return 'media'
  if (normalized.some((tag) => ['communication', 'email', 'messaging', 'chat'].includes(tag))) return 'productivity'
  if (normalized.some((tag) => ['productivity', 'calendar', 'task', 'workflow', 'automation'].includes(tag))) return 'productivity'
  if (normalized.some((tag) => ['data', 'analytics', 'database', 'weather', 'places', 'finance'].includes(tag))) return 'data'
  if (normalized.some((tag) => ['security', 'audit', 'guard', 'policy'].includes(tag))) return 'security'
  if (normalized.some((tag) => ['integration', 'api', 'workspace', 'connector', 'mcp'].includes(tag))) return 'integrations'
  if (normalized.includes('agent')) return 'agent'
  if (normalized.includes('search')) return 'search'
  if (normalized.includes('browser')) return 'browser'
  if (normalized.includes('coding') || normalized.includes('code')) return 'coding'
  if (slug.includes('github')) return 'coding'
  return undefined
}

function normalizeSourceCategory(category?: string): MarketplaceCategory | undefined {
  if (!category) {
    return undefined
  }

  const normalized = category.trim().toLowerCase()
  const aliases: Record<string, MarketplaceCategory> = {
    agent: 'agent',
    agents: 'agent',
    '智能体': 'agent',
    memory: 'memory',
    '记忆': 'memory',
    document: 'documents',
    documents: 'documents',
    '文档': 'documents',
    media: 'media',
    '媒体': 'media',
    productivity: 'productivity',
    '效率': 'productivity',
    '生产力': 'productivity',
    data: 'data',
    '数据': 'data',
    security: 'security',
    '安全': 'security',
    integration: 'integrations',
    integrations: 'integrations',
    '集成': 'integrations',
    coding: 'coding',
    code: 'coding',
    '编码': 'coding',
    '代码': 'coding',
    other: 'other',
    '其他': 'other',
    search: 'data',
    '搜索': 'data',
    browser: 'integrations',
    '浏览器': 'integrations',
  }

  return aliases[normalized]
}
