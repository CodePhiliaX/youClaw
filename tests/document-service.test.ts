import { afterEach, describe, expect, test } from 'bun:test'
import { unlinkSync } from 'node:fs'
import './setup.ts'
import { cleanTables, getDatabase } from './setup.ts'
import { chunkText } from '../src/document/chunker.ts'
import { documentService } from '../src/document/service.ts'
import { buildParsedDocumentsPrompt } from '../src/agent/document-mcp.ts'
import { extractDocxText, extractXlsxText } from '../src/document/parsers/office.ts'
import { extractPdfText } from '../src/document/parsers/pdf.ts'

function buildPdf(text: string): Buffer {
  const stream = `BT\n/F1 24 Tf\n100 100 Td\n(${text}) Tj\nET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += `${obj}\n`
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8')
  pdf += 'xref\n0 6\n0000000000 65535 f \n'

  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }

  pdf += `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'utf8')
}

async function writeMinimalDocx(filePath: string, text: string): Promise<void> {
  const { zipSync } = await import('fflate')
  const files = {
    '[Content_Types].xml': new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    '_rels/.rels': new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    'word/document.xml': new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`),
  }

  const zip = zipSync(files)
  await Bun.write(filePath, zip)
}

async function writeTableDocx(filePath: string): Promise<void> {
  const { zipSync } = await import('fflate')
  const files = {
    '[Content_Types].xml': new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    '_rels/.rels': new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    'word/document.xml': new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>试卷内容</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>选择题</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>填空题</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>问答题</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>判断题</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`),
  }

  const zip = zipSync(files)
  await Bun.write(filePath, zip)
}

afterEach(() => {
  cleanTables('document_chunks', 'documents')
})

describe('chunkText', () => {
  test('splits long text into ordered chunks', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} with some content.`).join('\n\n')
    const chunks = chunkText(text, { documentId: 'doc_test', maxChunkChars: 80, overlapChars: 10 })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.id).toBe('doc_test:chunk:0')
    expect(chunks[1]?.ordinal).toBe(1)
  })
})

describe('documentService', () => {
  test('extracts text from a PDF buffer via pdfjs', async () => {
    const parsed = await extractPdfText(buildPdf('Hello PDF'))

    expect(parsed.pageCount).toBe(1)
    expect(parsed.text).toContain('Hello PDF')
  })

  test('ingests xlsx attachments into structured document chunks', async () => {
    const XLSX = await import('xlsx')
    const workbook = XLSX.utils.book_new()
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ['Metric', 'Value'],
      ['Revenue', '42%'],
    ])
    const detailsSheet = XLSX.utils.aoa_to_sheet([
      ['Region', 'Status'],
      ['APAC', 'Growing quickly'],
    ])
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')
    XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Details')

    const filePath = `/tmp/report-${Date.now()}.xlsx`
    XLSX.writeFile(workbook, filePath)

    try {
      const textOnly = await extractXlsxText(filePath)
      expect(textOnly.sheetNames).toEqual(['Summary', 'Details'])
      expect(textOnly.text).toContain('Sheet: Summary')
      expect(textOnly.text).toContain('Growing quickly')

      const parsed = await documentService.ingestAttachment('chat-xlsx', {
        filename: 'report.xlsx',
        mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filePath,
      })

      expect(parsed.status).toBe('parsed')
      expect(parsed.sourceType).toBe('xlsx')
      expect(parsed.meta.sheetNames).toEqual(['Summary', 'Details'])
      expect(parsed.chunks).toHaveLength(2)
      expect(parsed.chunks[0]?.sheet).toBe('Summary')
      expect(parsed.chunks[1]?.sheet).toBe('Details')
    } finally {
      unlinkSync(filePath)
    }
  })

  test('extracts docx text and fails empty docx parsing clearly', async () => {
    const docxPath = `/tmp/docx-${Date.now()}.docx`
    const emptyDocxPath = `/tmp/docx-empty-${Date.now()}.docx`

    try {
      await writeMinimalDocx(docxPath, '模拟试卷四 选择题 填空题 问答题')
      await writeMinimalDocx(emptyDocxPath, '')

      const extracted = await extractDocxText(docxPath)
      expect(extracted.text).toContain('模拟试卷四')

      const parsed = await documentService.ingestAttachment('chat-docx', {
        filename: 'mock.docx',
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filePath: docxPath,
      })
      expect(parsed.status).toBe('parsed')
      expect(parsed.sourceType).toBe('docx')
      expect(parsed.text).toContain('选择题')

      const emptyParsed = await documentService.ingestAttachment('chat-docx', {
        filename: 'empty.docx',
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filePath: emptyDocxPath,
      })
      expect(emptyParsed.status).toBe('failed')
      expect(emptyParsed.error).toContain('No extractable text found')
    } finally {
      try { unlinkSync(docxPath) } catch {}
      try { unlinkSync(emptyDocxPath) } catch {}
    }
  })

  test('extracts table-heavy docx content through mammoth parser', async () => {
    const filePath = `/tmp/docx-table-${Date.now()}.docx`

    try {
      await writeTableDocx(filePath)
      const extracted = await extractDocxText(filePath)

      expect(extracted.parser).toBe('mammoth-raw')
      expect(extracted.text).toContain('试卷内容')
      expect(extracted.text).toContain('选择题')
      expect(extracted.text).toContain('判断题')
    } finally {
      try { unlinkSync(filePath) } catch {}
    }
  })

  test('searches parsed chunks within the same chat and reads chunk content', () => {
    const db = getDatabase()
    db.run(
      `INSERT INTO documents (id, chat_id, filename, source_type, status, source_path, markdown_path, json_path, error, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'doc_1',
        'chat-1',
        'report.pdf',
        'pdf',
        'parsed',
        '/tmp/report.pdf',
        null,
        null,
        null,
        '2026-03-19T00:00:00.000Z',
        '2026-03-19T00:00:00.000Z',
        JSON.stringify({ filename: 'report.pdf', parser: 'test' }),
      ],
    )
    db.run(
      `INSERT INTO document_chunks (id, document_id, chat_id, ordinal, title, content, page, sheet, slide, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['chunk-1', 'doc_1', 'chat-1', 0, 'Intro', 'Revenue grew 42 percent year over year.', 1, null, null, null],
    )
    db.run(
      `INSERT INTO document_chunks (id, document_id, chat_id, ordinal, title, content, page, sheet, slide, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['chunk-2', 'doc_1', 'chat-1', 1, 'Details', 'Customer churn remained low in the quarter.', 2, null, null, null],
    )

    const hits = documentService.searchDocument('chat-1', 'revenue year over year')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.chunkId).toBe('chunk-1')
    expect(hits[0]?.documentId).toBe('doc_1')

    const chunk = documentService.getChunk('doc_1', 'chunk-1')
    expect(chunk?.content).toContain('Revenue grew 42 percent')
    expect(chunk?.page).toBe(1)
  })
})

describe('buildParsedDocumentsPrompt', () => {
  test('separates parsed and failed documents in the prompt', () => {
    const prompt = buildParsedDocumentsPrompt([
      { docId: 'doc_ok', filename: 'ok.pdf', status: 'parsed' },
      { docId: 'doc_fail', filename: 'fail.pdf', status: 'failed', error: 'parse error' },
    ])

    expect(prompt).toContain('[Parsed documents]')
    expect(prompt).toContain('mcp__document__search_document')
    expect(prompt).toContain('[Document parse failed]')
    expect(prompt).toContain('fail.pdf -> doc_fail')
  })
})
