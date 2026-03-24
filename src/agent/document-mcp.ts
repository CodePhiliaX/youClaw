import { basename } from 'node:path'
import { Type } from '@mariozechner/pi-ai'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import type { Attachment } from '../types/attachment.ts'
import { documentService } from '../document/service.ts'
import { getLogger } from '../logger/index.ts'

const ParseDocumentParams = Type.Object({
  file_path: Type.String({ description: 'Absolute path to the local document file' }),
  media_type: Type.Optional(Type.String({ description: 'Optional media type when filename extension is missing or ambiguous' })),
})

const ParsePdfParams = Type.Object({
  file_path: Type.String({ description: 'Absolute path to the local PDF file' }),
})

const SearchDocumentParams = Type.Object({
  query: Type.String({ description: 'The user question or keywords to search for' }),
  document_id: Type.Optional(Type.String({ description: 'Optional parsed document id to scope the search' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of hits to return' })),
})

const ReadDocumentChunkParams = Type.Object({
  document_id: Type.String({ description: 'Parsed document id' }),
  chunk_id: Type.String({ description: 'Chunk id returned by search_document' }),
})

function isDocumentAttachment(attachment: Attachment): boolean {
  return documentService.isSupportedAttachment(attachment)
}

export async function ingestDocumentAttachments(
  chatId: string,
  attachments?: Attachment[],
  onDocumentStatus?: (event: { documentId: string; filename: string; status: 'parsing' | 'parsed' | 'failed'; error?: string }) => void,
): Promise<{ parsedDocuments: Array<{ docId: string; filename: string; status: 'parsed' | 'failed'; error?: string }>; remainingAttachments: Attachment[] }> {
  if (!attachments || attachments.length === 0) {
    return { parsedDocuments: [], remainingAttachments: [] }
  }

  const parsedDocuments: Array<{ docId: string; filename: string; status: 'parsed' | 'failed'; error?: string }> = []
  const remainingAttachments: Attachment[] = []

  for (const attachment of attachments) {
    if (!isDocumentAttachment(attachment)) {
      remainingAttachments.push(attachment)
      continue
    }

    onDocumentStatus?.({
      documentId: 'pending',
      filename: attachment.filename,
      status: 'parsing',
    })
    const parsed = await documentService.ingestAttachment(chatId, attachment)
    onDocumentStatus?.({
      documentId: parsed.docId,
      filename: parsed.meta.filename,
      status: parsed.status,
      error: parsed.error,
    })
    parsedDocuments.push({
      docId: parsed.docId,
      filename: parsed.meta.filename,
      status: parsed.status,
      error: parsed.error,
    })
  }

  return { parsedDocuments, remainingAttachments }
}

export function buildParsedDocumentsPrompt(parsedDocuments: Array<{ docId: string; filename: string; status: 'parsed' | 'failed'; error?: string }>): string {
  if (parsedDocuments.length === 0) return ''

  const ready = parsedDocuments.filter((doc) => doc.status === 'parsed')
  const failed = parsedDocuments.filter((doc) => doc.status === 'failed')
  const parts: string[] = []

  if (ready.length > 0) {
    const list = ready
      .map((doc) => `- ${doc.filename} -> ${doc.docId}`)
      .join('\n')
    parts.push(
      `[Parsed documents]\n${list}\n` +
      'Use `mcp__document__search_document` to find relevant chunks in these parsed documents, then use ' +
      '`mcp__document__read_document_chunk` to read the best chunk(s). Do not use `Read` on the original file when a parsed document is available.'
    )
  }

  if (failed.length > 0) {
    const list = failed
      .map((doc) => `- ${doc.filename} -> ${doc.docId}${doc.error ? ` (${doc.error})` : ''}`)
      .join('\n')
    parts.push(
      `[Document parse failed]\n${list}\n` +
      'These documents could not be parsed into structured chunks. Tell the user parsing failed instead of pretending the document was read successfully.'
    )
  }

  return parts.join('\n\n')
}

export function createDocumentTools(chatId: string): ToolDefinition[] {
  return [
    {
      name: 'mcp__document__parse_document',
      label: 'mcp__document__parse_document',
      description: 'Parse a local document file (PDF, DOCX, XLSX, or PPTX) into the document store and return a document id.',
      parameters: ParseDocumentParams,
      async execute(_toolCallId, args: { file_path: string; media_type?: string }) {
        const logger = getLogger()
        try {
          const parsed = await documentService.ingestAttachment(chatId, {
            filename: basename(args.file_path),
            mediaType: args.media_type ?? 'application/octet-stream',
            filePath: args.file_path,
          })
          if (parsed.status !== 'parsed') {
            throw new Error(parsed.error ?? 'unknown error')
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                document_id: parsed.docId,
                filename: parsed.meta.filename,
                source_type: parsed.sourceType,
                chunk_count: parsed.chunks.length,
              }, null, 2),
            }],
            details: { documentId: parsed.docId },
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.error({ error: msg, file_path: args.file_path, category: 'document' }, 'parse_document tool failed')
          throw new Error(`Failed to parse document: ${msg}`)
        }
      },
    },
    {
      name: 'mcp__document__parse_pdf',
      label: 'mcp__document__parse_pdf',
      description: 'Legacy alias for parse_document restricted to PDF files.',
      parameters: ParsePdfParams,
      async execute(_toolCallId, args: { file_path: string }) {
        const logger = getLogger()
        try {
          const parsed = await documentService.ingestAttachment(chatId, {
            filename: basename(args.file_path),
            mediaType: 'application/pdf',
            filePath: args.file_path,
          })
          if (parsed.status !== 'parsed') {
            throw new Error(parsed.error ?? 'unknown error')
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                document_id: parsed.docId,
                filename: parsed.meta.filename,
                source_type: parsed.sourceType,
                chunk_count: parsed.chunks.length,
              }, null, 2),
            }],
            details: { documentId: parsed.docId },
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.error({ error: msg, file_path: args.file_path, category: 'document' }, 'parse_pdf tool failed')
          throw new Error(`Failed to parse PDF: ${msg}`)
        }
      },
    },
    {
      name: 'mcp__document__search_document',
      label: 'mcp__document__search_document',
      description: 'Search parsed documents for relevant chunks. If document_id is omitted, searches parsed documents attached to the current chat.',
      parameters: SearchDocumentParams,
      async execute(_toolCallId, args: { query: string; document_id?: string; limit?: number }) {
        try {
          const hits = documentService.searchDocument(chatId, args.query, args.document_id, args.limit ?? 5)
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ hits }, null, 2),
            }],
            details: { hitCount: hits.length, documentId: args.document_id },
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(`Failed to search document: ${msg}`)
        }
      },
    },
    {
      name: 'mcp__document__read_document_chunk',
      label: 'mcp__document__read_document_chunk',
      description: 'Read a specific parsed document chunk by document id and chunk id.',
      parameters: ReadDocumentChunkParams,
      async execute(_toolCallId, args: { document_id: string; chunk_id: string }) {
        try {
          const chunk = documentService.getChunk(args.document_id, args.chunk_id)
          if (!chunk) {
            throw new Error(`Chunk not found: ${args.chunk_id}`)
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                document_id: chunk.documentId,
                chunk_id: chunk.id,
                ordinal: chunk.ordinal,
                title: chunk.title,
                content: chunk.content,
                page: chunk.page,
                sheet: chunk.sheet,
                slide: chunk.slide,
              }, null, 2),
            }],
            details: { documentId: chunk.documentId, chunkId: chunk.id },
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(`Failed to read document chunk: ${msg}`)
        }
      },
    },
  ]
}
