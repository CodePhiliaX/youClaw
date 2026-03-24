import type { Attachment } from '../types/attachment'

export type PendingChatAttachment = {
  filename: string
  mediaType: string
  filePath?: string
  file?: File
}

export async function resolveChatAttachments(
  files: PendingChatAttachment[],
  uploadAttachment: (file: File, filename?: string, mediaType?: string) => Promise<Attachment>,
): Promise<Attachment[]> {
  return Promise.all(
    files.map(async (file) => {
      if (file.filePath) {
        return {
          filename: file.filename,
          mediaType: file.mediaType,
          filePath: file.filePath,
        }
      }

      if (!file.file) {
        throw new Error(`Attachment "${file.filename || 'unnamed'}" is missing file data`)
      }

      return uploadAttachment(file.file, file.filename, file.mediaType)
    }),
  )
}
