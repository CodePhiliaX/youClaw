import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { resolve, basename, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { getPaths } from '../config/paths.ts'
import { extractDocxText, extractPptxText, extractXlsxText } from '../document/parsers/office.ts'
import { extractPdfText } from '../document/parsers/pdf.ts'
import { getLogger } from '../logger/index.ts'
import type { Attachment } from '../types/attachment.ts'

type Converter = (filePath: string, cacheDir: string) => Promise<ConvertResult>

interface ConvertResult {
  text: string
  // Extra image attachments extracted from the document
  images?: Array<{ filename: string; mediaType: string; filePath: string }>
}

// Media types that require conversion to plain text
const CONVERTIBLE_TYPES: Record<string, Converter> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': convertDocx,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': convertXlsx,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': convertPptx,
  'application/pdf': convertPdf,
}

// Extension-based fallback for cases where mediaType is generic
const EXTENSION_MAP: Record<string, Converter> = {
  '.docx': convertDocx,
  '.xlsx': convertXlsx,
  '.pptx': convertPptx,
  '.pdf': convertPdf,
}

function getCacheDir(): string {
  const paths = getPaths()
  return resolve(paths.data, 'doc-cache')
}

function computeHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * Preprocess attachments: convert binary documents (DOCX/XLSX/PPTX/PDF) to plain text.
 * DOCX images are extracted and returned as additional image attachments.
 * Converted files are cached in DATA_DIR/doc-cache/.
 * Non-convertible attachments pass through unchanged.
 */
export async function preprocessAttachments(attachments: Attachment[]): Promise<Attachment[]> {
  const logger = getLogger()
  const results: Attachment[] = []

  for (const attachment of attachments) {
    const converter = CONVERTIBLE_TYPES[attachment.mediaType]
      ?? EXTENSION_MAP[extname(attachment.filename).toLowerCase()]

    if (!converter) {
      results.push(attachment)
      continue
    }

    try {
      const { textPath, images } = await convertWithCache(
        attachment.filePath, attachment.filename, converter,
      )
      results.push({
        filename: attachment.filename,
        mediaType: 'text/plain',
        filePath: textPath,
      })
      // Append extracted images as separate attachments
      if (images && images.length > 0) {
        results.push(...images)
      }
      logger.info({
        original: attachment.filePath,
        cached: textPath,
        imageCount: images?.length ?? 0,
        category: 'document-converter',
      }, 'Document converted to text')
    } catch (err) {
      // Graceful degradation: fall back to original file
      logger.warn({
        file: attachment.filePath,
        error: err instanceof Error ? err.message : String(err),
        category: 'document-converter',
      }, 'Document conversion failed, using original file')
      results.push(attachment)
    }
  }

  return results
}

async function convertWithCache(
  filePath: string,
  filename: string,
  converter: Converter,
): Promise<{ textPath: string; images?: Attachment[] }> {
  const cacheDir = getCacheDir()
  mkdirSync(cacheDir, { recursive: true })

  const content = readFileSync(filePath)
  const hash = computeHash(content)
  const name = basename(filename, extname(filename))
  const cachedFile = resolve(cacheDir, `${name}-${hash}.txt`)

  if (existsSync(cachedFile)) {
    // Validate cache: skip empty files (likely from a failed previous conversion)
    const size = statSync(cachedFile).size
    if (size > 0) {
      const images = collectCachedImages(cacheDir, name, hash)
      return { textPath: cachedFile, images }
    }
    // Empty cache file — remove and re-convert
    unlinkSync(cachedFile)
  }

  const result = await converter(filePath, cacheDir)
  writeFileSync(cachedFile, result.text, 'utf-8')

  const images = result.images?.map((img) => ({
    filename: img.filename,
    mediaType: img.mediaType,
    filePath: img.filePath,
  }))

  return { textPath: cachedFile, images }
}

/** Collect previously saved image files for a cached document */
function collectCachedImages(cacheDir: string, name: string, hash: string): Attachment[] {
  const images: Attachment[] = []
  const prefix = `${name}-${hash}-img`
  // Scan for image files matching the pattern
  try {
    for (const file of readdirSync(cacheDir)) {
      if (!file.startsWith(prefix)) continue
      const ext = extname(file).toLowerCase()
      const mediaType = IMAGE_EXT_MAP[ext]
      if (!mediaType) continue
      images.push({
        filename: file,
        mediaType,
        filePath: resolve(cacheDir, file),
      })
    }
  } catch {
    // Ignore — no cached images
  }
  return images
}

const IMAGE_EXT_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.emf': 'image/emf',
  '.wmf': 'image/wmf',
}

async function convertDocx(filePath: string, _cacheDir: string): Promise<ConvertResult> {
  const parsed = await extractDocxText(filePath)
  return { text: parsed.text }
}

async function convertXlsx(filePath: string, _cacheDir: string): Promise<ConvertResult> {
  const parsed = await extractXlsxText(filePath)
  return { text: parsed.text }
}

async function convertPptx(filePath: string, _cacheDir: string): Promise<ConvertResult> {
  const parsed = await extractPptxText(filePath)
  return { text: parsed.text }
}

async function convertPdf(filePath: string, _cacheDir: string): Promise<ConvertResult> {
  const buffer = readFileSync(filePath)
  const data = await extractPdfText(buffer)
  return { text: data.text }
}
