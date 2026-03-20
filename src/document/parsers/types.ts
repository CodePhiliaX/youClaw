import type { DocumentChunk } from '../types.ts'

export type ParsedChunkInput = Omit<DocumentChunk, 'id' | 'documentId'>

export interface ParsedDocumentContent {
  text: string
  parser: string
  markdown?: string
  pageCount?: number
  sheetNames?: string[]
  slideCount?: number
  chunks?: ParsedChunkInput[]
}
