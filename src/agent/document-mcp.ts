import { basename } from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import type { Attachment } from '../types/attachment.ts'
import { documentService } from '../document/service.ts'
import { getLogger } from '../logger/index.ts'

function isPdfAttachment(attachment: Attachment): boolean {
  return attachment.mediaType === 'application/pdf' || attachment.filename.toLowerCase().endsWith('.pdf')
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
    if (!isPdfAttachment(attachment)) {
      remainingAttachments.push(attachment)
      continue
    }

    onDocumentStatus?.({
      documentId: 'pending',
      filename: attachment.filename,
      status: 'parsing',
    })
    const parsed = await documentService.ingestPdfAttachment(chatId, attachment)
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
      '`mcp__document__read_document_chunk` to read the best chunk(s). Do not use `Read` on the original PDF when a parsed document is available.'
    )
  }

  if (failed.length > 0) {
    const list = failed
      .map((doc) => `- ${doc.filename} -> ${doc.docId}${doc.error ? ` (${doc.error})` : ''}`)
      .join('\n')
    parts.push(
      `[Document parse failed]\n${list}\n` +
      'These PDFs could not be parsed into structured chunks. Tell the user parsing failed instead of pretending the document was read successfully.'
    )
  }

  return parts.join('\n\n')
}

export function createDocumentMcpServer(chatId: string) {
  return createSdkMcpServer({
    name: 'document',
    version: '1.0.0',
    tools: [
      tool(
        'parse_pdf',
        'Parse a local PDF file into a structured document in the document store and return a document id.',
        {
          file_path: z.string().describe('Absolute path to the local PDF file'),
        },
        async (args) => {
          const logger = getLogger()
          try {
            const parsed = await documentService.ingestPdfAttachment(chatId, {
              filename: basename(args.file_path),
              mediaType: 'application/pdf',
              filePath: args.file_path,
            })
            if (parsed.status !== 'parsed') {
              return {
                content: [{ type: 'text' as const, text: `Failed to parse PDF: ${parsed.error ?? 'unknown error'}` }],
                isError: true,
              }
            }
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  document_id: parsed.docId,
                  filename: parsed.meta.filename,
                  chunk_count: parsed.chunks.length,
                }, null, 2),
              }],
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.error({ error: msg, file_path: args.file_path, category: 'document' }, 'parse_pdf tool failed')
            return { content: [{ type: 'text' as const, text: `Failed to parse PDF: ${msg}` }], isError: true }
          }
        },
      ),
      tool(
        'search_document',
        'Search parsed documents for relevant chunks. If document_id is omitted, searches parsed documents attached to the current chat.',
        {
          query: z.string().describe('The user question or keywords to search for'),
          document_id: z.string().optional().describe('Optional parsed document id to scope the search'),
          limit: z.number().int().min(1).max(10).optional().describe('Maximum number of hits to return'),
        },
        async (args) => {
          try {
            const hits = documentService.searchDocument(chatId, args.query, args.document_id, args.limit ?? 5)
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ hits }, null, 2),
              }],
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text: `Failed to search document: ${msg}` }], isError: true }
          }
        },
      ),
      tool(
        'read_document_chunk',
        'Read a specific parsed document chunk by document id and chunk id.',
        {
          document_id: z.string().describe('Parsed document id'),
          chunk_id: z.string().describe('Chunk id returned by search_document'),
        },
        async (args) => {
          try {
            const chunk = documentService.getChunk(args.document_id, args.chunk_id)
            if (!chunk) {
              return { content: [{ type: 'text' as const, text: `Chunk not found: ${args.chunk_id}` }], isError: true }
            }
            return {
              content: [{
                type: 'text' as const,
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
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text: `Failed to read document chunk: ${msg}` }], isError: true }
          }
        },
      ),
    ],
  })
}
