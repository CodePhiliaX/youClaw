// src/types/attachment.ts
export interface Attachment {
  filename: string
  mediaType: string
  data: string
  size: number
}

export const ALLOWED_MEDIA_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv',
] as const

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
export const MAX_FILES = 5
