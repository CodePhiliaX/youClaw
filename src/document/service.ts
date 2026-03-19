import { createHash, randomUUID } from 'node:crypto'
import { basename, extname, resolve } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Attachment } from '../types/attachment.ts'
import { getPaths } from '../config/index.ts'
import { getDatabase } from '../db/index.ts'
import { getLogger } from '../logger/index.ts'
import { chunkText } from './chunker.ts'
import { extractPdfText } from './parsers/pdf.ts'
import type { DocumentChunk, DocumentSearchHit, DocumentSourceType, ParsedDocument } from './types.ts'

interface StoredDocumentRow {
  id: string
  chat_id: string
  filename: string
  source_type: string
  status: string
  source_path: string
  markdown_path: string | null
  json_path: string | null
  error: string | null
  created_at: string
  updated_at: string
  metadata_json: string | null
}

interface StoredChunkRow {
  id: string
  document_id: string
  ordinal: number
  title: string | null
  content: string
  page: number | null
  sheet: string | null
  slide: number | null
  metadata_json: string | null
}

function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function getDocumentsDir(): string {
  return resolve(getPaths().data, 'documents')
}

function snippetFor(content: string, query: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  const lower = normalized.toLowerCase()
  const index = lower.indexOf(query.toLowerCase())
  if (index < 0) return normalized.slice(0, 220)
  const start = Math.max(0, index - 80)
  const end = Math.min(normalized.length, index + query.length + 140)
  return normalized.slice(start, end)
}

function scoreChunk(content: string, query: string): number {
  const haystack = content.toLowerCase()
  const needles = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)

  if (needles.length === 0) return haystack.includes(query.toLowerCase()) ? 1 : 0

  return needles.reduce((score, token) => {
    let index = 0
    let matches = 0
    while (true) {
      index = haystack.indexOf(token, index)
      if (index < 0) break
      matches++
      index += token.length
    }
    return score + matches
  }, 0)
}

export class DocumentService {
  async ingestPdfAttachment(chatId: string, attachment: Attachment): Promise<ParsedDocument> {
    const logger = getLogger()
    const sourceType = this.inferSourceType(attachment)
    if (sourceType !== 'pdf') {
      throw new Error(`Unsupported source type for PDF ingestion: ${attachment.filename}`)
    }

    const fileHash = computeFileHash(attachment.filePath)
    const docId = `doc_${fileHash}`
    const existing = this.getDocument(docId)
    if (existing && existing.status === 'parsed') {
      this.bindDocumentToChat(docId, chatId)
      return existing
    }

    const now = new Date().toISOString()
    const docDir = resolve(getDocumentsDir(), docId)
    mkdirSync(docDir, { recursive: true })

    logger.info({
      chatId,
      docId,
      file: attachment.filePath,
      filename: attachment.filename,
      category: 'document',
    }, 'Parsing PDF attachment into document store')

    try {
      const buffer = readFileSync(attachment.filePath)
      const data = await extractPdfText(buffer)
      const text = data.text.trim()
      const chunks = chunkText(text, { documentId: docId })
      const document: ParsedDocument = {
        docId,
        chatId,
        sourcePath: attachment.filePath,
        sourceType: 'pdf',
        status: 'parsed',
        markdown: text,
        text,
        chunks,
        meta: {
          filename: attachment.filename,
          parser: 'pdfjs-dist',
          pageCount: data.pageCount,
        },
        createdAt: now,
        updatedAt: now,
      }
      this.saveDocument(document, docDir)
      return document
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failedDoc: ParsedDocument = {
        docId,
        chatId,
        sourcePath: attachment.filePath,
        sourceType: 'pdf',
        status: 'failed',
        chunks: [],
        meta: {
          filename: attachment.filename,
          parser: 'pdfjs-dist',
        },
        error: message,
        createdAt: now,
        updatedAt: now,
      }
      this.saveDocument(failedDoc, docDir)
      logger.warn({
        chatId,
        docId,
        file: attachment.filePath,
        filename: attachment.filename,
        error: message,
        category: 'document',
      }, 'PDF attachment parsing failed')
      return failedDoc
    }
  }

  searchDocument(chatId: string, query: string, documentId?: string, limit = 5): DocumentSearchHit[] {
    const db = getDatabase()
    let rows: StoredChunkRow[]

    if (documentId) {
      rows = db.query(
        `SELECT id, document_id, ordinal, title, content, page, sheet, slide, metadata_json
         FROM document_chunks
         WHERE document_id = ?`,
      ).all(documentId) as StoredChunkRow[]
    } else {
      rows = db.query(
        `SELECT dc.id, dc.document_id, dc.ordinal, dc.title, dc.content, dc.page, dc.sheet, dc.slide, dc.metadata_json
         FROM document_chunks dc
         JOIN documents d ON d.id = dc.document_id
         WHERE d.chat_id = ? AND d.status = 'parsed'`,
      ).all(chatId) as StoredChunkRow[]
    }

    return rows
      .map((row) => {
        const score = scoreChunk(row.content, query)
        return {
          chunkId: row.id,
          documentId: row.document_id,
          ordinal: row.ordinal,
          title: row.title ?? undefined,
          snippet: snippetFor(row.content, query),
          score,
          page: row.page ?? undefined,
          sheet: row.sheet ?? undefined,
          slide: row.slide ?? undefined,
        }
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)
      .slice(0, limit)
  }

  getChunk(documentId: string, chunkId: string): DocumentChunk | null {
    const db = getDatabase()
    const row = db.query(
      `SELECT id, document_id, ordinal, title, content, page, sheet, slide, metadata_json
       FROM document_chunks
       WHERE document_id = ? AND id = ?`,
    ).get(documentId, chunkId) as StoredChunkRow | null

    if (!row) return null
    return {
      id: row.id,
      documentId: row.document_id,
      ordinal: row.ordinal,
      title: row.title ?? undefined,
      content: row.content,
      page: row.page ?? undefined,
      sheet: row.sheet ?? undefined,
      slide: row.slide ?? undefined,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : undefined,
    }
  }

  getDocument(documentId: string): ParsedDocument | null {
    const db = getDatabase()
    const row = db.query(
      `SELECT id, chat_id, filename, source_type, status, source_path, markdown_path, json_path, error, created_at, updated_at, metadata_json
       FROM documents
       WHERE id = ?`,
    ).get(documentId) as StoredDocumentRow | null

    if (!row) return null

    const chunks = db.query(
      `SELECT id, document_id, ordinal, title, content, page, sheet, slide, metadata_json
       FROM document_chunks
       WHERE document_id = ?
       ORDER BY ordinal ASC`,
    ).all(documentId) as StoredChunkRow[]

    const metadata = row.metadata_json ? JSON.parse(row.metadata_json) as ParsedDocument['meta'] : {
      filename: row.filename,
      parser: 'unknown',
    }

    let markdown: string | undefined
    if (row.markdown_path && existsSync(row.markdown_path)) {
      markdown = readFileSync(row.markdown_path, 'utf-8')
    }

    return {
      docId: row.id,
      chatId: row.chat_id,
      sourcePath: row.source_path,
      sourceType: row.source_type as DocumentSourceType,
      status: row.status as ParsedDocument['status'],
      markdown,
      text: markdown,
      chunks: chunks.map((chunk) => ({
        id: chunk.id,
        documentId: chunk.document_id,
        ordinal: chunk.ordinal,
        title: chunk.title ?? undefined,
        content: chunk.content,
        page: chunk.page ?? undefined,
        sheet: chunk.sheet ?? undefined,
        slide: chunk.slide ?? undefined,
        metadata: chunk.metadata_json ? JSON.parse(chunk.metadata_json) as Record<string, unknown> : undefined,
      })),
      meta: metadata,
      error: row.error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private inferSourceType(attachment: Attachment): DocumentSourceType | null {
    const ext = extname(attachment.filename).toLowerCase()
    if (attachment.mediaType === 'application/pdf' || ext === '.pdf') return 'pdf'
    if (ext === '.docx') return 'docx'
    if (ext === '.xlsx') return 'xlsx'
    if (ext === '.pptx') return 'pptx'
    return null
  }

  private bindDocumentToChat(documentId: string, chatId: string): void {
    const db = getDatabase()
    db.run(
      `UPDATE documents
       SET chat_id = ?, updated_at = ?
       WHERE id = ?`,
      [chatId, new Date().toISOString(), documentId],
    )
  }

  private saveDocument(document: ParsedDocument, docDir: string): void {
    const db = getDatabase()
    mkdirSync(getDocumentsDir(), { recursive: true })
    mkdirSync(docDir, { recursive: true })

    const markdownPath = resolve(docDir, 'document.md')
    const jsonPath = resolve(docDir, 'document.json')

    if (document.markdown !== undefined) {
      writeFileSync(markdownPath, document.markdown, 'utf-8')
    }
    writeFileSync(jsonPath, JSON.stringify(document, null, 2), 'utf-8')

    db.run(
      `INSERT OR REPLACE INTO documents
       (id, chat_id, filename, source_type, status, source_path, markdown_path, json_path, error, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        document.docId,
        document.chatId,
        document.meta.filename,
        document.sourceType,
        document.status,
        document.sourcePath,
        document.markdown !== undefined ? markdownPath : null,
        jsonPath,
        document.error ?? null,
        document.createdAt,
        document.updatedAt,
        JSON.stringify(document.meta),
      ],
    )

    db.run('DELETE FROM document_chunks WHERE document_id = ?', [document.docId])
    for (const chunk of document.chunks) {
      db.run(
        `INSERT INTO document_chunks
         (id, document_id, chat_id, ordinal, title, content, page, sheet, slide, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          chunk.id || randomUUID(),
          document.docId,
          document.chatId,
          chunk.ordinal,
          chunk.title ?? null,
          chunk.content,
          chunk.page ?? null,
          chunk.sheet ?? null,
          chunk.slide ?? null,
          chunk.metadata ? JSON.stringify(chunk.metadata) : null,
        ],
      )
    }
  }
}

export const documentService = new DocumentService()
