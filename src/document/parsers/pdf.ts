import type { ParsedDocumentContent } from './types.ts'

// pdfjs-dist references DOMMatrix at module load time (canvas rendering code).
// Polyfill it before importing so the sidecar does not crash on startup.
if (typeof (globalThis as Record<string, unknown>).DOMMatrix === 'undefined') {
  (globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0

    constructor(_init?: unknown) {}
    invertSelf() { return this }
    multiplySelf() { return this }
    preMultiplySelf() { return this }
    translate() { return this }
    scale() { return this }
  }
}

// In Bun compiled sidecars, pdfjs' default "./pdf.worker.mjs" resolution points
// into $bunfs and fails. Preload the worker module and expose it on globalThis so
// fake-worker setup can reuse it without relative path resolution.
const [pdfjs, pdfjsWorker] = await Promise.all([
  import('pdfjs-dist/legacy/build/pdf.mjs'),
  import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
])

;(globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker

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

async function extractPageText(page: import('pdfjs-dist/types/src/display/api').PDFPageProxy): Promise<string> {
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

export async function extractPdfText(data: Buffer | Uint8Array): Promise<ParsedDocumentContent> {
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
      markdown: pages.join('\n\n'),
      parser: 'pdfjs-dist',
      pageCount: doc.numPages,
    }
  } finally {
    await doc.destroy()
  }
}
