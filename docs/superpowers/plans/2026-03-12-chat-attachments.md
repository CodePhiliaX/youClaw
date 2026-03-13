# Chat Attachments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to send file attachments (images + documents) to agents, persisted in DB and displayed in message history.

**Architecture:** Base64-encoded files flow inline through the existing JSON API. The `messages` table gains an `attachments TEXT` column. The frontend's PromptInput already handles file selection/drag-drop; we connect that to the full send → store → SDK → display pipeline.

**Tech Stack:** React, Hono, bun:sqlite, @anthropic-ai/claude-agent-sdk, Zod v4 (`zod/v4`), Tailwind CSS

---

## Chunk 1: Backend Type & Database Layer

### Task 1: Add Attachment type definition (backend)

**Files:**
- Create: `src/types/attachment.ts`

- [ ] **Step 1: Create the shared Attachment type**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/types/attachment.ts
git commit -m "feat: add Attachment type definition"
```

### Task 2: Add attachments column to database

**Files:**
- Modify: `src/db/index.ts:110-117` (migrations section)
- Modify: `src/db/index.ts:127-143` (saveMessage)
- Modify: `src/db/index.ts:145-158` (getMessages return type)

- [ ] **Step 1: Add migration for attachments column**

In `src/db/index.ts`, after line 114 (`ALTER TABLE task_run_logs ADD COLUMN delivery_status`), add:

```typescript
  // 迁移：添加附件列
  try { _db.exec('ALTER TABLE messages ADD COLUMN attachments TEXT') } catch {}
```

- [ ] **Step 2: Update saveMessage to accept attachments**

In `src/db/index.ts`, modify the `saveMessage` function (lines 127-143):

```typescript
export function saveMessage(msg: {
  id: string
  chatId: string
  sender: string
  senderName: string
  content: string
  timestamp: string
  isFromMe: boolean
  isBotMessage: boolean
  attachments?: string  // pre-stringified JSON
}) {
  const db = getDatabase()
  db.run(
    `INSERT OR REPLACE INTO messages (id, chat_id, sender, sender_name, content, timestamp, is_from_me, is_bot_message, attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [msg.id, msg.chatId, msg.sender, msg.senderName, msg.content, msg.timestamp, msg.isFromMe ? 1 : 0, msg.isBotMessage ? 1 : 0, msg.attachments ?? null]
  )
}
```

- [ ] **Step 3: Update getMessages return type**

In `src/db/index.ts`, modify the `getMessages` return type (line 145-148):

```typescript
export function getMessages(chatId: string, limit = 50, before?: string): Array<{
  id: string; chat_id: string; sender: string; sender_name: string
  content: string; timestamp: string; is_from_me: number; is_bot_message: number
  attachments: string | null
}> {
```

- [ ] **Step 4: Commit**

```bash
git add src/db/index.ts
git commit -m "feat: add attachments column to messages table"
```

### Task 3: Add attachments to InboundMessage and ProcessParams

**Files:**
- Modify: `src/channel/types.ts:1-14` (InboundMessage)
- Modify: `src/agent/types.ts:18-24` (ProcessParams)

- [ ] **Step 1: Update InboundMessage**

In `src/channel/types.ts`, add after `requestedSkills` field (line 12):

```typescript
  attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>
```

- [ ] **Step 2: Update ProcessParams**

In `src/agent/types.ts`, add after `browserProfileId` field (line 23):

```typescript
  attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>
```

- [ ] **Step 3: Commit**

```bash
git add src/channel/types.ts src/agent/types.ts
git commit -m "feat: add attachments field to InboundMessage and ProcessParams"
```

### Task 4: Update MessageRouter to save and pass attachments

**Files:**
- Modify: `src/channel/router.ts:80-91` (saveMessage call)
- Modify: `src/channel/router.ts:97-102` (enqueue call)

- [ ] **Step 1: Add attachments to saveMessage call**

In `src/channel/router.ts`, modify the saveMessage call (lines 80-91) to add:

```typescript
      saveMessage({
        id: message.id,
        chatId: message.chatId,
        sender: message.sender,
        senderName: message.senderName,
        content: message.content,
        timestamp: message.timestamp,
        isFromMe: false,
        isBotMessage: false,
        attachments: message.attachments ? JSON.stringify(message.attachments) : undefined,
      })
```

- [ ] **Step 2: Pass attachments to enqueue**

In `src/channel/router.ts`, modify the enqueue call (lines 97-102) to add attachments:

```typescript
      const reply = await this.agentQueue.enqueue(
        config.id,
        message.chatId,
        contentForAgent,
        requestedSkills.length > 0 ? requestedSkills : undefined,
        message.browserProfileId,
        message.attachments,
      )
```

- [ ] **Step 3: Commit**

```bash
git add src/channel/router.ts
git commit -m "feat: pass attachments through MessageRouter to DB and queue"
```

### Task 5: Update AgentQueue to pass attachments

**Files:**
- Modify: `src/agent/queue.ts:4-12` (QueueItem)
- Modify: `src/agent/queue.ts:36-49` (enqueue)
- Modify: `src/agent/queue.ts:133-139` (processItem)

- [ ] **Step 1: Add attachments to QueueItem**

In `src/agent/queue.ts`, add to QueueItem interface (after line 9, `browserProfileId`):

```typescript
  attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>
```

- [ ] **Step 2: Update enqueue signature**

In `src/agent/queue.ts`, modify enqueue (line 36):

```typescript
  async enqueue(agentId: string, chatId: string, prompt: string, requestedSkills?: string[], browserProfileId?: string, attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>): Promise<string> {
```

And update the push (line 40):

```typescript
      queue.push({ agentId, chatId, prompt, requestedSkills, browserProfileId, attachments, resolve, reject })
```

- [ ] **Step 3: Update processItem to pass attachments**

In `src/agent/queue.ts`, modify the process call (lines 133-139):

```typescript
      const result = await managed.runtime.process({
        chatId: item.chatId,
        prompt: item.prompt,
        agentId: item.agentId,
        requestedSkills: item.requestedSkills,
        browserProfileId: item.browserProfileId,
        attachments: item.attachments,
      })
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/queue.ts
git commit -m "feat: pass attachments through AgentQueue"
```

### Task 6: Update AgentRuntime to build SDK multimodal message

**Files:**
- Modify: `src/agent/runtime.ts:97-105` (process → executeQuery call)
- Modify: `src/agent/runtime.ts:178-187` (executeQuery signature)
- Modify: `src/agent/runtime.ts:254-257` (query() call)

- [ ] **Step 1: Pass attachments from process to executeQuery**

In `src/agent/runtime.ts`, modify the executeQuery call (lines 97-105):

```typescript
      const { fullText, sessionId } = await this.executeQuery(
        finalPrompt,
        agentId,
        chatId,
        existingSessionId,
        env.AGENT_MODEL,
        params.requestedSkills,
        params.browserProfileId,
        params.attachments,
      )
```

- [ ] **Step 2: Update executeQuery signature**

In `src/agent/runtime.ts`, modify executeQuery (lines 178-187):

```typescript
  private async executeQuery(
    prompt: string,
    agentId: string,
    chatId: string,
    existingSessionId: string | null,
    model: string,
    requestedSkills?: string[],
    browserProfileId?: string,
    attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>,
  ): Promise<{ fullText: string; sessionId: string }> {
```

- [ ] **Step 3: Build SDKUserMessage when attachments present**

In `src/agent/runtime.ts`, modify the query() call (lines 254-257). Replace:

```typescript
    const q = query({
      prompt,
      options: queryOptions as Parameters<typeof query>[0]['options'],
    })
```

With:

```typescript
    let q
    if (attachments && attachments.length > 0) {
      // 构建多模态 content blocks
      const content: Array<Record<string, unknown>> = [
        { type: 'text', text: prompt },
      ]
      for (const a of attachments) {
        if (a.mediaType.startsWith('image/')) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: a.mediaType, data: a.data },
          })
        } else {
          content.push({
            type: 'document',
            source: { type: 'base64', media_type: a.mediaType, data: a.data },
          })
        }
      }

      const userMessage = {
        type: 'user' as const,
        message: { role: 'user' as const, content },
        parent_tool_use_id: null,
        session_id: existingSessionId || '',
      }

      async function* singleMessage<T>(msg: T) { yield msg }

      q = query({
        prompt: singleMessage(userMessage) as Parameters<typeof query>[0]['prompt'],
        options: queryOptions as Parameters<typeof query>[0]['options'],
      })
    } else {
      q = query({
        prompt,
        options: queryOptions as Parameters<typeof query>[0]['options'],
      })
    }
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/runtime.ts
git commit -m "feat: build SDK multimodal message for attachments"
```

### Task 7: Update messages route to accept attachments

**Files:**
- Modify: `src/routes/messages.ts:12-48` (POST handler)
- Modify: `src/routes/messages.ts` (GET handler for parsing)

- [ ] **Step 1: Add Zod validation and accept attachments in POST**

In `src/routes/messages.ts`, add import at top:

```typescript
import { z } from 'zod/v4'
import { ALLOWED_MEDIA_TYPES, MAX_FILE_SIZE, MAX_FILES } from '../types/attachment.ts'
```

Modify the POST handler (lines 12-48). Replace the body parsing and validation:

```typescript
  messages.post('/agents/:id/message', async (c) => {
    const agentId = c.req.param('id')

    const AttachmentSchema = z.object({
      filename: z.string(),
      mediaType: z.enum(ALLOWED_MEDIA_TYPES),
      data: z.string(),
      size: z.number().max(MAX_FILE_SIZE),
    })
    const BodySchema = z.object({
      prompt: z.string().min(1),
      chatId: z.string().optional(),
      skills: z.array(z.string()).optional(),
      browserProfileId: z.string().optional(),
      attachments: z.array(AttachmentSchema).max(MAX_FILES).optional(),
    })

    const parseResult = BodySchema.safeParse(await c.req.json())
    if (!parseResult.success) {
      return c.json({ error: 'Invalid request', details: parseResult.error.issues }, 400)
    }
    const body = parseResult.data

    const managed = agentManager.getAgent(agentId)
    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const chatId = body.chatId ?? `web:${randomUUID()}`

    const inbound: InboundMessage = {
      id: randomUUID(),
      chatId,
      sender: 'user',
      senderName: 'User',
      content: body.prompt,
      timestamp: new Date().toISOString(),
      isGroup: false,
      agentId,
      requestedSkills: body.skills,
      browserProfileId: body.browserProfileId,
      attachments: body.attachments,
    }

    router.handleInbound(inbound)
    return c.json({ chatId, status: 'processing' })
  })
```

- [ ] **Step 2: Parse attachments in GET handler**

In the GET `/api/chats/:chatId/messages` handler, add JSON.parse for attachments before returning. Find where `getMessages` result is returned and map:

```typescript
    const msgs = getMessages(chatId, limit, before)
    const parsed = msgs.map(m => ({
      ...m,
      attachments: m.attachments ? JSON.parse(m.attachments) : null,
    }))
    return c.json(parsed.reverse())
```

- [ ] **Step 3: Configure Hono body size limit for the messages route**

In `src/routes/messages.ts`, add import for `bodyLimit` middleware and apply to the POST route:

```typescript
import { bodyLimit } from 'hono/body-limit'
```

Apply the middleware to the messages POST route (before the handler):

```typescript
  messages.post('/agents/:id/message', bodyLimit({ maxSize: 75 * 1024 * 1024 }), async (c) => {
```

This allows up to ~75MB request bodies (5 files × 10MB × 1.33 base64 overhead + JSON overhead).

- [ ] **Step 4: Commit**

```bash
git add src/routes/messages.ts
git commit -m "feat: accept and validate attachments in messages API"
```

---

## Chunk 2: Frontend Pipeline

### Task 8: Add Attachment type definition (frontend)

**Files:**
- Create: `web/src/types/attachment.ts`

- [ ] **Step 1: Create the frontend Attachment type**

```typescript
// web/src/types/attachment.ts
export interface Attachment {
  filename: string
  mediaType: string
  data: string
  size: number
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/types/attachment.ts
git commit -m "feat: add frontend Attachment type"
```

### Task 9: Update API client to send attachments

**Files:**
- Modify: `web/src/api/client.ts:14-19` (sendMessage)

- [ ] **Step 1: Add attachments parameter to sendMessage and update getMessages type**

```typescript
import type { Attachment } from '../types/attachment'

export async function sendMessage(agentId: string, prompt: string, chatId?: string, browserProfileId?: string, attachments?: Attachment[]) {
  return apiFetch<{ chatId: string; status: string }>(`/api/agents/${agentId}/message`, {
    method: 'POST',
    body: JSON.stringify({ prompt, chatId, browserProfileId, attachments }),
  })
}
```

Also update the `getMessages` return type to include `attachments`:

```typescript
export async function getMessages(chatId: string) {
  return apiFetch<Array<{ id: string; chat_id: string; sender: string; sender_name: string; content: string; timestamp: string; is_from_me: number; is_bot_message: number; attachments: Attachment[] | null }>>(`/api/chats/${encodeURIComponent(chatId)}/messages`)
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/api/client.ts
git commit -m "feat: pass attachments in sendMessage API call"
```

### Task 10: Update useChat hook

**Files:**
- Modify: `web/src/hooks/useChat.ts:5-18` (Message type)
- Modify: `web/src/hooks/useChat.ts:88-114` (send function)
- Modify: `web/src/hooks/useChat.ts` (loadChat function)

- [ ] **Step 1: Add attachments to Message type**

In `web/src/hooks/useChat.ts`, import and add to Message type (around line 5-18):

```typescript
import type { Attachment } from '../types/attachment'
```

Add field to Message type:

```typescript
  attachments?: Attachment[]
```

- [ ] **Step 2: Update send function signature and body**

Modify `send` (line 88) to accept attachments:

```typescript
  const send = useCallback(async (prompt: string, browserProfileId?: string, attachments?: Attachment[]) => {
```

Include attachments in the local user message:

```typescript
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
      attachments,
    }
```

Pass attachments to sendMessage:

```typescript
    const data = await sendMessage(agentId, prompt, currentChatId, browserProfileId, attachments)
```

- [ ] **Step 3: Update loadChat to parse attachments**

In the `loadChat` function, where messages are mapped from the API response, include attachments:

```typescript
      attachments: (raw as { attachments?: Attachment[] | null }).attachments ?? undefined,
```

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useChat.ts
git commit -m "feat: pass attachments through useChat hook"
```

### Task 11: Update useChatContext

**Files:**
- Modify: `web/src/hooks/useChatContext.tsx:16` (send type)

- [ ] **Step 1: Update ChatContextType send signature**

In `web/src/hooks/useChatContext.tsx`, modify the send type (line 16):

```typescript
  send: (prompt: string, browserProfileId?: string, attachments?: Attachment[]) => Promise<void>
```

Add import:

```typescript
import type { Attachment } from '../types/attachment'
```

- [ ] **Step 2: Commit**

```bash
git add web/src/hooks/useChatContext.tsx
git commit -m "feat: update useChatContext send signature for attachments"
```

### Task 12: Update ChatInput to extract and pass attachments

**Files:**
- Modify: `web/src/components/chat/ChatInput.tsx:23-27` (handleSubmit)

- [ ] **Step 1: Convert FileUIPart data URLs to Attachment objects and pass to send**

Replace the `handleSubmit` function:

```typescript
  const handleSubmit = async (msg: PromptInputMessage) => {
    const text = msg.text.trim();
    if (!text && msg.files.length === 0) return;

    // 将 data URL 转为 Attachment 对象
    const attachments = msg.files
      .map((f) => {
        const match = f.url.match(/^data:([^;]+);base64,(.+)$/s);
        if (!match) return null;
        const [, mediaType, data] = match;
        const padding = (data.match(/=+$/) || [''])[0].length;
        const size = Math.floor(data.length * 3 / 4) - padding;
        return { filename: f.filename, mediaType, data, size };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    send(text, selectedProfileId ?? undefined, attachments.length > 0 ? attachments : undefined);
  };
```

- [ ] **Step 2: Add accept/maxFiles/maxFileSize props to PromptInput**

In the JSX, update the `<PromptInput>` component to pass file constraints:

```tsx
      <PromptInput
        onSubmit={handleSubmit}
        accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv"
        maxFiles={5}
        maxFileSize={10 * 1024 * 1024}
      >
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/chat/ChatInput.tsx
git commit -m "feat: extract attachments from PromptInput and pass to send"
```

---

## Chunk 3: Message Display

### Task 13: Update UserMessage to display attachments

**Files:**
- Modify: `web/src/components/chat/UserMessage.tsx`

- [ ] **Step 1: Add attachment rendering to UserMessage**

Modify the existing `UserMessage.tsx` — preserve its current structure (imports, Avatar, timestamp) and add attachment rendering below `message.content`. The current file uses these imports:

```tsx
import { User } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Message as AIMessage, MessageContent } from '@/components/ai-elements/message'
import { useI18n } from '@/i18n'
import type { Message } from '@/hooks/useChat'
```

Add new imports:

```tsx
import { FileIcon, FileTextIcon } from 'lucide-react'
```

(Merge with existing `lucide-react` import: `import { User, FileIcon, FileTextIcon } from 'lucide-react'`)

Add helper components before `UserMessage`:

```tsx
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentImage({ data, mediaType, filename }: { data: string; mediaType: string; filename: string }) {
  return (
    <button
      type="button"
      className="rounded-lg overflow-hidden border border-border hover:opacity-90 transition-opacity cursor-pointer"
      onClick={() => {
        const w = window.open()
        if (w) {
          w.document.write(`<img src="data:${mediaType};base64,${data}" alt="${filename}" style="max-width:100%">`)
          w.document.title = filename
        }
      }}
    >
      <img
        src={`data:${mediaType};base64,${data}`}
        alt={filename}
        className="max-w-[200px] max-h-[200px] object-cover"
      />
    </button>
  )
}

function AttachmentFile({ filename, mediaType, size }: { filename: string; mediaType: string; size: number }) {
  const Icon = mediaType.startsWith('text/') ? FileTextIcon : FileIcon
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 bg-muted/50 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate max-w-[160px]">{filename}</span>
      <span className="text-muted-foreground text-xs shrink-0">{formatFileSize(size)}</span>
    </div>
  )
}
```

Then modify the `UserMessage` component body. After the existing `<MessageContent>` opening and `<p>` tag for `message.content` (line 26), add attachment rendering:

```tsx
export function UserMessage({ message }: { message: Message }) {
  const { t } = useI18n()
  const images = message.attachments?.filter(a => a.mediaType.startsWith('image/')) ?? []
  const files = message.attachments?.filter(a => !a.mediaType.startsWith('image/')) ?? []

  return (
    <AIMessage from="user" data-testid="message-user">
      <div className="flex gap-3 py-3 flex-row-reverse">
        <Avatar className="h-8 w-8 mt-0.5">
          <AvatarFallback className="text-[10px] font-semibold bg-blue-500/20 text-blue-500">
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 flex flex-col items-end">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            {t.chat.you}
            <span className="ml-2 text-[10px] opacity-60">
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <MessageContent>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {images.map((a, i) => (
                  <AttachmentImage key={i} data={a.data} mediaType={a.mediaType} filename={a.filename} />
                ))}
              </div>
            )}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {files.map((a, i) => (
                  <AttachmentFile key={i} filename={a.filename} mediaType={a.mediaType} size={a.size} />
                ))}
              </div>
            )}
          </MessageContent>
        </div>
      </div>
    </AIMessage>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/chat/UserMessage.tsx
git commit -m "feat: display image thumbnails and file cards in user messages"
```

### Task 14: Smoke test and final verification

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: No type errors

- [ ] **Step 2: Run dev server and test manually**

```bash
pnpm dev &
pnpm dev:web &
```

Test checklist:
1. Open chat, click attachment button, select an image → see preview in input area
2. Send message with image → image thumbnail appears in message
3. Click thumbnail → opens full-size in new window
4. Send a PDF → file card with icon, name, size appears
5. Send text-only message → works as before (no regression)
6. Reload page → attachments still visible in message history

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues found during attachment smoke test"
```
