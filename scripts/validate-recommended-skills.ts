import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { parseFrontmatter } from '../src/skills/frontmatter.ts'

type RecommendedEntry = {
  slug: string
  displayName: string
  summary: string
  category: string
}

type SkillDetailResponse = {
  skill?: {
    slug?: string
    displayName?: string
    summary?: string | null
  } | null
  moderation?: {
    isSuspicious?: boolean
    isMalwareBlocked?: boolean
    verdict?: string | null
  } | null
}

type ArchiveEntry = {
  archivePath: string
  relativePath: string
  content: Uint8Array
}

const CLAWHUB_API_BASE = 'https://clawhub.ai/api/v1'
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024
const MAX_ZIP_ENTRY_COUNT = 200
const MAX_ZIP_ENTRY_BYTES = 512 * 1024
const VALID_CATEGORIES = new Set(['agent', 'search', 'browser', 'coding'])

function normalizeArchiveSegments(filePath: string): string[] {
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

function unpackSkillArchive(zipBuffer: Uint8Array): ArchiveEntry[] {
  const archive = unzipSync(zipBuffer)
  const rawEntries = Object.entries(archive).map(([archivePath, content]) => ({
    archivePath,
    segments: normalizeArchiveSegments(archivePath),
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

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json,application/zip,*/*',
        'User-Agent': 'youclaw-recommended-validator',
      },
    })

    if (response.status !== 429 || attempt === 11) {
      return response
    }

    const retryAfter = Number.parseInt(response.headers.get('retry-after') || '1', 10)
    await Bun.sleep((Number.isFinite(retryAfter) ? Math.max(retryAfter, 1) : 1) * 1000)
  }

  throw new Error(`Unexpected retry loop for ${url}`)
}

async function validateEntry(entry: RecommendedEntry) {
  if (!VALID_CATEGORIES.has(entry.category)) {
    throw new Error(`Unsupported category "${entry.category}"`)
  }

  const detailResponse = await fetchWithRetry(`${CLAWHUB_API_BASE}/skills/${encodeURIComponent(entry.slug)}`)
  if (!detailResponse.ok) {
    throw new Error(`Detail request failed: HTTP ${detailResponse.status}`)
  }

  const detail = await detailResponse.json() as SkillDetailResponse
  const liveSkill = detail.skill
  if (!liveSkill?.slug || !liveSkill.displayName || typeof liveSkill.summary !== 'string') {
    throw new Error('Detail payload is missing required fields')
  }
  if (liveSkill.slug !== entry.slug) {
    throw new Error(`Detail slug mismatch: ${liveSkill.slug}`)
  }
  if (liveSkill.displayName !== entry.displayName) {
    throw new Error(`Display name mismatch: expected "${liveSkill.displayName}"`)
  }
  if (liveSkill.summary !== entry.summary) {
    throw new Error('Summary mismatch with live marketplace detail')
  }

  if (detail.moderation?.isMalwareBlocked) {
    throw new Error('Skill is malware-blocked and cannot be recommended')
  }
  if (detail.moderation?.isSuspicious) {
    throw new Error('Skill is marked suspicious and cannot be recommended')
  }

  const downloadResponse = await fetchWithRetry(`${CLAWHUB_API_BASE}/download?slug=${encodeURIComponent(entry.slug)}`)
  if (!downloadResponse.ok) {
    throw new Error(`Download request failed: HTTP ${downloadResponse.status}`)
  }

  const contentLength = Number.parseInt(downloadResponse.headers.get('content-length') || '0', 10)
  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Archive exceeds ${MAX_DOWNLOAD_BYTES} bytes`)
  }

  const archiveBuffer = new Uint8Array(await downloadResponse.arrayBuffer())
  if (archiveBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Archive exceeds ${MAX_DOWNLOAD_BYTES} bytes`)
  }

  const entries = unpackSkillArchive(archiveBuffer)
  const skillMd = entries.find((archiveEntry) => archiveEntry.relativePath === 'SKILL.md')
  if (!skillMd) {
    throw new Error('Archive does not contain a root SKILL.md')
  }

  parseFrontmatter(Buffer.from(skillMd.content).toString('utf-8'))
}

async function main() {
  const entries = JSON.parse(
    readFileSync(new URL('../src/skills/recommended-skills.json', import.meta.url), 'utf-8'),
  ) as RecommendedEntry[]

  const seen = new Set<string>()
  let hasFailure = false

  for (const entry of entries) {
    if (seen.has(entry.slug)) {
      console.error(`FAIL ${entry.slug}: duplicate slug`)
      hasFailure = true
      continue
    }
    seen.add(entry.slug)

    try {
      await validateEntry(entry)
      console.log(`OK   ${entry.slug}`)
    } catch (error) {
      hasFailure = true
      const message = error instanceof Error ? error.message : String(error)
      console.error(`FAIL ${entry.slug}: ${message}`)
    }
  }

  if (hasFailure) {
    process.exitCode = 1
    return
  }

  console.log(`Validated ${entries.length} recommended skills`)
}

await main()
