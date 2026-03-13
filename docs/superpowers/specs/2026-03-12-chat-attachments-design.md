# Chat Attachments Design

## Overview

Enable users to send file attachments (images and documents) to agents via the chat interface, with attachments persisted in the database and displayed in message history.

## Approach

**JSON Body + messages table extension** — Files are base64-encoded on the frontend and sent inline in the existing JSON API. The messages table gains an `attachments TEXT` column storing a JSON array. This is the simplest approach that integrates seamlessly with the existing architecture, suitable for the expected file sizes (<10MB).

## Data Structure

```typescript
// Frontend: web/src/types/attachment.ts
// Backend: src/types/attachment.ts (duplicated, same interface)
interface Attachment {
  filename: string    // Original filename
  mediaType: string   // MIME type, e.g. "image/png", "application/pdf"
  data: string        // Base64-encoded file content
  size: number        // Decoded file size in bytes
}
```

Size computation from base64:
```typescript
const padding = (base64.match(/=+$/) || [''])[0].length
const size = Math.floor(base64.length * 3 / 4) - padding
```

This structure is used consistently across the entire pipeline: frontend → API → backend → database → display. The type is defined separately in both frontend and backend since they are separate TypeScript compilation targets.

## Data Flow

### Sending

```
User selects files → PromptInput produces FileUIPart[] (with data URLs from convertBlobUrlToDataUrl)
  → ChatInput.handleSubmit parses data URLs to extract base64 + mediaType
    → useChat.send(text, attachments[])
      → API client: POST JSON { prompt, chatId, attachments }
        → Backend messages route validates with Zod schema (import from zod/v4)
          → MessageRouter saves to DB (messages.attachments JSON column)
            → AgentQueue (attachments in QueueItem) → AgentRuntime.process
              → Build SDKUserMessage with MessageParam content blocks
              → SDK executes via query({ prompt: asyncIterable })
              → Streams response
```

### Displaying

```
GET /api/chats/:chatId/messages → Route handler JSON.parses attachments column
  → useChat.loadChat maps to Message (including attachments)
    → UserMessage (web/src/components/chat/UserMessage.tsx, existing component) renders:
        Image → Clickable thumbnail (max-width ~200px), lightbox on click
        Document → File card (type icon + filename + readable size)
```

## Frontend Changes

### ChatInput.tsx
- Modify `handleSubmit` to extract `msg.files` (which are already data URLs from PromptInput's `convertBlobUrlToDataUrl`)
- Parse each data URL: strip `data:<mediaType>;base64,` prefix to get pure base64 data
- Extract mediaType from the data URL prefix or from `FileUIPart.mediaType`
- Compute size from base64 length (accounting for padding)
- Pass resulting `Attachment[]` to `send(text, attachments)`

### PromptInput props
- Pass `accept` to restrict to supported image + document types
- Set `maxFileSize: 10MB`
- Set `maxFiles: 5`

### useChat.ts
- Extend `Message` type: add `attachments?: Attachment[]`
- Extend `send` signature: `send(prompt: string, attachments?: Attachment[])`
- Include `attachments` in local user message object
- Pass attachments to `sendMessage` API call
- Update `loadChat` to parse `attachments` field from API response into `Message` objects

### useChatContext.tsx
- Update `ChatContextType` interface: `send: (prompt: string, attachments?: Attachment[]) => Promise<void>`
- Update `ChatProvider` to pass through the new signature

### client.ts
- Extend `sendMessage` to accept and include `attachments` in JSON body

### UserMessage.tsx (existing: web/src/components/chat/UserMessage.tsx)
- Add attachment display area below message text
- Images: thumbnail grid, click to open lightbox
- Documents: file card with type icon, filename, and human-readable size

## Backend Changes

### messages route (src/routes/messages.ts)
- Extend POST handler request body with Zod schema (import from `zod/v4`):
  ```typescript
  import { z } from 'zod/v4'

  const AttachmentSchema = z.object({
    filename: z.string(),
    mediaType: z.string(),
    data: z.string(),
    size: z.number(),
  })
  const MessageBodySchema = z.object({
    prompt: z.string(),
    chatId: z.string().optional(),
    skills: z.array(z.string()).optional(),
    attachments: z.array(AttachmentSchema).max(5).optional(),
  })
  ```
- Validate mediaType against whitelist
- Validate decoded base64 size ≤ 10MB per file
- Configure Hono body parser limit to handle up to ~70MB (5 files × 10MB × 1.33 base64 overhead)
- GET handler: JSON.parse the `attachments` column in the route handler before returning (map over `getMessages` results)

### InboundMessage (src/channel/types.ts)
- Add `attachments?: Attachment[]` field

### MessageRouter (src/channel/router.ts)
- JSON.stringify attachments when saving to database
- Pass attachments through to `agentQueue.enqueue`

### Database (src/db/index.ts)
- Migration: `ALTER TABLE messages ADD COLUMN attachments TEXT` (try/catch pattern)
- Update `saveMessage` parameter type: add `attachments?: string` (pre-stringified JSON)
- Update INSERT SQL to include `attachments` column
- Update `getMessages` return to include raw `attachments` TEXT column

### AgentQueue (src/agent/queue.ts)
- Add `attachments?: Attachment[]` to `QueueItem` interface
- Update `enqueue` method signature to accept attachments
- Update `processItem` to include attachments in `process()` call

### AgentRuntime (src/agent/runtime.ts)
- Extend `ProcessParams`: add `attachments?: Attachment[]`
- In `executeQuery`, when attachments are present, construct an `SDKUserMessage` and pass as `AsyncIterable` to `query()`:
  ```typescript
  import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

  // Build multi-part MessageParam content
  const content = [
    { type: 'text' as const, text: prompt },
    ...attachments.map(a => {
      if (a.mediaType.startsWith('image/')) {
        return { type: 'image' as const, source: { type: 'base64' as const, media_type: a.mediaType, data: a.data } }
      }
      return { type: 'document' as const, source: { type: 'base64' as const, media_type: a.mediaType, data: a.data } }
    }),
  ]

  const userMessage: SDKUserMessage = {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: existingSessionId || '',  // Required field; empty string for new sessions
  }

  // Wrap in async generator for query()
  async function* singleMessage(msg: SDKUserMessage) { yield msg }

  const q = query({
    prompt: singleMessage(userMessage),
    options: queryOptions,
  })
  ```
- When no attachments, continue using the existing `prompt: string` path (no behavior change)

## Constraints

### Supported file types
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Documents: `application/pdf`, `text/plain`, `text/markdown`, `text/csv`

### Limits
- Max file size: 10MB per file
- Max attachments: 5 per message
- Validation on both frontend (at selection time) and backend (at receipt)
- Hono body parser limit increased to ~70MB to accommodate max payload

### Error handling
- File too large → Frontend toast, block send
- Unsupported type → Frontend toast, block add
- Invalid base64 or size exceeds limit → Backend returns 400
- SDK-unsupported format → Skip attachment, log warning

### Known limitations
- Electron IPC path: large attachments (~67MB JSON) may cause performance issues or hit IPC message size limits. For the initial implementation this is acceptable; a file-based transfer approach can be added as a follow-up if needed.

## Out of Scope
- Upload progress bar (base64 inline, single request)
- Attachment download functionality
- Image compression/resizing
- Assistant message attachments (Claude returns text)
- Drag-to-reorder attachments
