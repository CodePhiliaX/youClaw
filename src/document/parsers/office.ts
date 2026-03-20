import { readFileSync } from 'node:fs'
import type { ParsedDocumentContent, ParsedChunkInput } from './types.ts'

type OfficeBinaryInput = string | Buffer | Uint8Array

function toBuffer(input: OfficeBinaryInput): Buffer {
  if (typeof input === 'string') {
    return readFileSync(input)
  }
  if (Buffer.isBuffer(input)) {
    return input
  }
  return Buffer.from(input)
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

export async function extractDocxText(input: OfficeBinaryInput): Promise<ParsedDocumentContent> {
  const mammoth = await import('mammoth')
  const buffer = toBuffer(input)
  const rawResult = await mammoth.extractRawText({ buffer })
  let text = normalizeText(rawResult.value)
  let parser = 'mammoth-raw'

  if (!text) {
    const htmlResult = await mammoth.convertToHtml({ buffer })
    text = normalizeText(stripHtml(htmlResult.value))
    parser = 'mammoth-html'
  }

  return {
    text,
    markdown: text,
    parser,
  }
}

export async function extractXlsxText(input: OfficeBinaryInput): Promise<ParsedDocumentContent> {
  const XLSX = await import('xlsx')
  const buffer = toBuffer(input)
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const parts: string[] = []
  const chunks: ParsedChunkInput[] = []

  for (const [ordinal, sheetName] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const csv = normalizeText(XLSX.utils.sheet_to_csv(sheet))
    if (!csv) continue

    parts.push(`--- Sheet: ${sheetName} ---\n${csv}`)
    chunks.push({
      ordinal,
      title: sheetName,
      content: csv,
      sheet: sheetName,
      metadata: { source: 'sheet' },
    })
  }

  return {
    text: parts.join('\n\n'),
    markdown: parts.join('\n\n'),
    parser: 'xlsx',
    sheetNames: workbook.SheetNames,
    chunks,
  }
}

export async function extractPptxText(input: OfficeBinaryInput): Promise<ParsedDocumentContent> {
  const { unzipSync } = await import('fflate')
  const buffer = toBuffer(input)
  const zip = unzipSync(new Uint8Array(buffer))

  const slideEntries = Object.keys(zip)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10)
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10)
      return numA - numB
    })

  const parts: string[] = []
  const chunks: ParsedChunkInput[] = []

  for (const [ordinal, entry] of slideEntries.entries()) {
    const xml = new TextDecoder().decode(zip[entry])
    const texts: string[] = []
    const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(xml)) !== null) {
      const text = match[1]?.trim() ?? ''
      if (text) texts.push(text)
    }

    if (texts.length === 0) continue

    const slideNum = parseInt(entry.match(/slide(\d+)/)?.[1] ?? `${ordinal + 1}`, 10)
    const content = texts.join('\n')
    parts.push(`--- Slide ${slideNum} ---\n${content}`)
    chunks.push({
      ordinal,
      title: `Slide ${slideNum}`,
      content,
      slide: slideNum,
      metadata: { source: 'slide' },
    })
  }

  return {
    text: parts.join('\n\n'),
    markdown: parts.join('\n\n'),
    parser: 'fflate-pptx',
    slideCount: slideEntries.length,
    chunks,
  }
}
