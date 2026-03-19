import { afterEach, describe, expect, mock, test } from 'bun:test'
import './setup.ts'
import { ingestDocumentAttachments } from '../src/agent/document-mcp.ts'
import { documentService } from '../src/document/service.ts'

const originalIngestPdfAttachment = documentService.ingestPdfAttachment.bind(documentService)

afterEach(() => {
  documentService.ingestPdfAttachment = originalIngestPdfAttachment
})

describe('ingestDocumentAttachments', () => {
  test('emits parsing and parsed status callbacks for PDF attachments', async () => {
    const callback = mock(() => {})
    documentService.ingestPdfAttachment = mock(async () => ({
      docId: 'doc_123',
      chatId: 'chat-1',
      sourcePath: '/tmp/report.pdf',
      sourceType: 'pdf' as const,
      status: 'parsed' as const,
      markdown: 'parsed text',
      text: 'parsed text',
      chunks: [],
      meta: { filename: 'report.pdf', parser: 'test' },
      createdAt: '2026-03-19T00:00:00.000Z',
      updatedAt: '2026-03-19T00:00:00.000Z',
    }))

    const result = await ingestDocumentAttachments('chat-1', [
      { filename: 'report.pdf', mediaType: 'application/pdf', filePath: '/tmp/report.pdf' },
    ], callback)

    expect(result.parsedDocuments).toEqual([
      { docId: 'doc_123', filename: 'report.pdf', status: 'parsed', error: undefined },
    ])
    expect(callback.mock.calls).toHaveLength(2)
    expect(callback.mock.calls[0]?.[0]).toEqual({
      documentId: 'pending',
      filename: 'report.pdf',
      status: 'parsing',
    })
    expect(callback.mock.calls[1]?.[0]).toEqual({
      documentId: 'doc_123',
      filename: 'report.pdf',
      status: 'parsed',
      error: undefined,
    })
  })

  test('passes through non-pdf attachments untouched', async () => {
    const result = await ingestDocumentAttachments('chat-1', [
      { filename: 'notes.txt', mediaType: 'text/plain', filePath: '/tmp/notes.txt' },
    ])

    expect(result.parsedDocuments).toEqual([])
    expect(result.remainingAttachments).toEqual([
      { filename: 'notes.txt', mediaType: 'text/plain', filePath: '/tmp/notes.txt' },
    ])
  })
})
