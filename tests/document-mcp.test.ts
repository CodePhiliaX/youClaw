import { afterEach, describe, expect, mock, test } from 'bun:test'
import './setup.ts'
import { ingestDocumentAttachments } from '../src/agent/document-mcp.ts'
import { documentService } from '../src/document/service.ts'

const originalIngestAttachment = documentService.ingestAttachment.bind(documentService)

afterEach(() => {
  documentService.ingestAttachment = originalIngestAttachment
})

describe('ingestDocumentAttachments', () => {
  test('emits parsing and parsed status callbacks for supported document attachments', async () => {
    const callback = mock(() => {})
    documentService.ingestAttachment = mock(async () => ({
      docId: 'doc_123',
      chatId: 'chat-1',
      sourcePath: '/tmp/report.pdf',
      sourceType: 'docx' as const,
      status: 'parsed' as const,
      markdown: 'parsed text',
      text: 'parsed text',
      chunks: [],
      meta: { filename: 'report.docx', parser: 'test' },
      createdAt: '2026-03-19T00:00:00.000Z',
      updatedAt: '2026-03-19T00:00:00.000Z',
    }))

    const result = await ingestDocumentAttachments('chat-1', [
      { filename: 'report.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filePath: '/tmp/report.docx' },
    ], callback)

    expect(result.parsedDocuments).toEqual([
      { docId: 'doc_123', filename: 'report.docx', status: 'parsed', error: undefined },
    ])
    expect(callback.mock.calls).toHaveLength(2)
    expect(callback.mock.calls[0]?.[0]).toEqual({
      documentId: 'pending',
      filename: 'report.docx',
      status: 'parsing',
    })
    expect(callback.mock.calls[1]?.[0]).toEqual({
      documentId: 'doc_123',
      filename: 'report.docx',
      status: 'parsed',
      error: undefined,
    })
  })

  test('passes through non-document attachments untouched', async () => {
    const result = await ingestDocumentAttachments('chat-1', [
      { filename: 'notes.txt', mediaType: 'text/plain', filePath: '/tmp/notes.txt' },
    ])

    expect(result.parsedDocuments).toEqual([])
    expect(result.remainingAttachments).toEqual([
      { filename: 'notes.txt', mediaType: 'text/plain', filePath: '/tmp/notes.txt' },
    ])
  })
})
