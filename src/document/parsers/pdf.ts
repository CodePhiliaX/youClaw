import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api'

interface ParsedPdfResult {
  text: string
  pageCount: number
}

interface TextItemLike {
  str: string
  transform?: number[]
  hasEOL?: boolean
}

function isTextItem(item: unknown): item is TextItemLike {
  return typeof item === 'object' && item !== null && 'str' in item && typeof (item as { str?: unknown }).str === 'string'
}

function isSameLine(previousY?: number, currentY?: number): boolean {
  if (previousY === undefined || currentY === undefined) return true
  return Math.abs(previousY - currentY) < 0.5
}

function normalizePageText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractPageText(page: PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent()

  let lastY: number | undefined
  let text = ''

  for (const item of textContent.items) {
    if (!isTextItem(item)) continue

    const currentY = item.transform?.[5]
    if (text && !isSameLine(lastY, currentY) && !text.endsWith('\n')) {
      text += '\n'
    }

    text += item.str

    if (item.hasEOL && !text.endsWith('\n')) {
      text += '\n'
    }

    lastY = currentY
  }

  return normalizePageText(text)
}

export async function extractPdfText(data: Buffer | Uint8Array): Promise<ParsedPdfResult> {
  const bytes = Buffer.isBuffer(data)
    ? new Uint8Array(data)
    : data instanceof Uint8Array
      ? data
      : new Uint8Array(data)
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  })

  const doc = await loadingTask.promise

  try {
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      try {
        const text = await extractPageText(page)
        if (text) {
          pages.push(text)
        }
      } finally {
        page.cleanup()
      }
    }

    return {
      text: pages.join('\n\n'),
      pageCount: doc.numPages,
    }
  } finally {
    await doc.destroy()
  }
}
