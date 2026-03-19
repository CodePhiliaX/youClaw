import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { resolve, basename, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { getPaths } from '../config/paths.ts'
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

async function convertDocx(filePath: string, cacheDir: string): Promise<ConvertResult> {
  const mammoth = await import('mammoth')
  const content = readFileSync(filePath)
  const hash = computeHash(content)
  const name = basename(filePath, extname(filePath))

  const images: Array<{ filename: string; mediaType: string; filePath: string }> = []
  let imageIndex = 0

  const result = await mammoth.convertToHtml(
    { path: filePath },
    {
      convertImage: mammoth.images.imgElement((image: { contentType: string; read: () => Promise<Buffer> }) => {
        // Save each image to cache dir
        const ext = image.contentType.split('/')[1] || 'png'
        const imgFilename = `${name}-${hash}-img${imageIndex}.${ext}`
        const imgPath = resolve(cacheDir, imgFilename)
        imageIndex++

        return image.read().then((buffer: Buffer) => {
          writeFileSync(imgPath, buffer)
          images.push({
            filename: imgFilename,
            mediaType: image.contentType,
            filePath: imgPath,
          })
          // Use a placeholder that we'll convert to [image: path] later
          return { src: `__IMAGE__${imgPath}__IMAGE__` }
        })
      }),
    },
  )

  // Convert HTML to plain text, replacing image placeholders
  let text = result.value
    // Replace image placeholders
    .replace(/<img[^>]*src="__IMAGE__([^"]+)__IMAGE__"[^>]*\/?>/g, '\n[image: $1]\n')
    // Strip remaining HTML tags
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Clean up excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { text, images }
}

async function convertXlsx(filePath: string, _cacheDir: string): Promise<ConvertResult> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.readFile(filePath)
  const parts: string[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const csv = XLSX.utils.sheet_to_csv(sheet)
    if (workbook.SheetNames.length > 1) {
      parts.push(`--- Sheet: ${sheetName} ---\n${csv}`)
    } else {
      parts.push(csv)
    }
  }

  return { text: parts.join('\n\n') }
}

async function convertPptx(filePath: string, _cacheDir: string): Promise<ConvertResult> {
  const { unzipSync } = await import('fflate')
  const buffer = readFileSync(filePath)
  const zip = unzipSync(new Uint8Array(buffer))

  // Extract slide XML files sorted by slide number
  const slideEntries = Object.keys(zip)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0')
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0')
      return numA - numB
    })

  const parts: string[] = []
  for (const entry of slideEntries) {
    const xml = new TextDecoder().decode(zip[entry])
    // Extract text from <a:t> tags
    const texts: string[] = []
    const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(xml)) !== null) {
      const text = match[1]?.trim() ?? ''
      if (text) texts.push(text)
    }
    if (texts.length > 0) {
      const slideNum = entry.match(/slide(\d+)/)?.[1] ?? '?'
      parts.push(`--- Slide ${slideNum} ---\n${texts.join('\n')}`)
    }
  }

  return { text: parts.join('\n\n') }
}

async function convertPdf(filePath: string, _cacheDir: string): Promise<ConvertResult> {
  const buffer = readFileSync(filePath)
  const data = await extractPdfText(buffer)
  return { text: data.text }
}
