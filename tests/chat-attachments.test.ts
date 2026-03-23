import { describe, expect, mock, test } from 'bun:test'
import { resolveChatAttachments } from '../web/src/lib/chat-attachments'

describe('resolveChatAttachments', () => {
  test('keeps attachments that already have file paths', async () => {
    const upload = mock(async () => {
      throw new Error('should not upload')
    })

    const result = await resolveChatAttachments(
      [
        {
          filename: 'report.pdf',
          mediaType: 'application/pdf',
          filePath: '/tmp/report.pdf',
        },
      ],
      upload,
    )

    expect(result).toEqual([
      {
        filename: 'report.pdf',
        mediaType: 'application/pdf',
        filePath: '/tmp/report.pdf',
      },
    ])
    expect(upload).not.toHaveBeenCalled()
  })

  test('uploads browser files that do not have local paths yet', async () => {
    const upload = mock(async (file: File, filename?: string, mediaType?: string) => ({
      filename: filename ?? file.name,
      mediaType: mediaType ?? file.type,
      filePath: `/tmp/${filename ?? file.name}`,
    }))

    const result = await resolveChatAttachments(
      [
        {
          filename: 'pasted-image.png',
          mediaType: 'image/png',
          file: new File(['image-bytes'], 'pasted-image.png', { type: 'image/png' }),
        },
      ],
      upload,
    )

    expect(upload).toHaveBeenCalledTimes(1)
    expect(result).toEqual([
      {
        filename: 'pasted-image.png',
        mediaType: 'image/png',
        filePath: '/tmp/pasted-image.png',
      },
    ])
  })

  test('throws when attachment is missing both filePath and file data', async () => {
    const upload = mock(async (_file: File) => ({
      filename: 'unused',
      mediaType: 'image/png',
      filePath: '/tmp/unused.png',
    }))

    await expect(
      resolveChatAttachments(
        [
          {
            filename: 'broken.png',
            mediaType: 'image/png',
          },
        ],
        upload,
      ),
    ).rejects.toThrow('Attachment "broken.png" is missing file data')
  })
})
