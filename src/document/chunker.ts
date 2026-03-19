import type { DocumentChunk } from './types.ts'

interface ChunkTextOptions {
  documentId: string
  maxChunkChars?: number
  overlapChars?: number
}

function normalizeParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function chunkText(
  text: string,
  options: ChunkTextOptions,
): DocumentChunk[] {
  const maxChunkChars = options.maxChunkChars ?? 1600
  const overlapChars = options.overlapChars ?? 160
  const paragraphs = normalizeParagraphs(text)
  if (paragraphs.length === 0) return []

  const chunks: DocumentChunk[] = []
  let current = ''
  let ordinal = 0

  const pushChunk = () => {
    const content = current.trim()
    if (!content) return
    chunks.push({
      id: `${options.documentId}:chunk:${ordinal}`,
      documentId: options.documentId,
      ordinal,
      content,
    })
    ordinal++
    current = content.slice(Math.max(0, content.length - overlapChars))
  }

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length <= maxChunkChars) {
      current = candidate
      continue
    }

    if (current) {
      pushChunk()
    }

    if (paragraph.length <= maxChunkChars) {
      current = paragraph
      continue
    }

    for (let start = 0; start < paragraph.length; start += maxChunkChars - overlapChars) {
      const slice = paragraph.slice(start, start + maxChunkChars).trim()
      if (!slice) continue
      chunks.push({
        id: `${options.documentId}:chunk:${ordinal}`,
        documentId: options.documentId,
        ordinal,
        content: slice,
      })
      ordinal++
    }
    current = ''
  }

  if (current) {
    pushChunk()
  }

  return chunks
}
