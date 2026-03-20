export type DocumentSourceType = 'pdf' | 'docx' | 'xlsx' | 'pptx'

export type DocumentStatus = 'parsed' | 'failed'

export interface DocumentChunk {
  id: string
  documentId: string
  ordinal: number
  title?: string
  content: string
  page?: number
  sheet?: string
  slide?: number
  metadata?: Record<string, unknown>
}

export interface ParsedDocumentMeta {
  filename: string
  parser: string
  pageCount?: number
  sheetNames?: string[]
  slideCount?: number
}

export interface ParsedDocument {
  docId: string
  chatId: string
  sourcePath: string
  sourceType: DocumentSourceType
  status: DocumentStatus
  markdown?: string
  text?: string
  chunks: DocumentChunk[]
  meta: ParsedDocumentMeta
  error?: string
  createdAt: string
  updatedAt: string
}

export interface DocumentSearchHit {
  chunkId: string
  documentId: string
  ordinal: number
  title?: string
  snippet: string
  score: number
  page?: number
  sheet?: string
  slide?: number
}
