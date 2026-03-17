# Per-Chat State Management Redesign

## Problem

Currently, the frontend manages chat state (thinking, streaming, tool_use) via a single `useChat(agentId)` hook instance in `ChatProvider`. When the user switches between chats, this instance resets all real-time state (`streamingText`, `isProcessing`, `pendingToolUse`), and the SSE connection is closed and re-established. This means:

- A chat that was mid-streaming loses its visual progress when switched away
- Switching back shows a blank state until the fallback polling catches up (8+ seconds)
- The sidebar cannot show which chats are actively processing
- Users cannot interact with multiple chats concurrently

The backend already supports concurrent chat processing (via `AgentQueue` with per-agent `maxConcurrency`) and per-chat SSE event routing (via `EventBus` filtered by `chatId`). The problem is entirely on the frontend.

## Requirements

1. Each chat maintains independent real-time state (messages, streamingText, isProcessing, pendingToolUse, chatStatus)
2. Switching chats only changes which chat is displayed, without resetting any chat's state
3. SSE connections persist in the background for all processing chats, not just the active one
4. The sidebar shows a processing indicator (spinner) on chats that are actively streaming
5. No limit on concurrent streaming chats (bounded naturally by backend maxConcurrency)
6. Agent switching behavior unchanged (resets state, as before)
7. All existing components consuming `useChatContext()` continue to work without modification

## Approach: Zustand Store + SSEManager

### Why This Approach

- **Zustand Store** with `Record<chatId, ChatState>` provides per-entity state management, perfect for multiple independent chats
- **SSEManager** as a standalone singleton (not a React hook) ensures SSE connections survive React re-renders and component unmounts
- **Thin hook layer** preserves the existing `ChatContextType` interface, requiring zero changes to downstream components

Alternatives considered:
- **Per-chat snapshot caching** (save/restore on switch): Cannot receive background SSE events, stale state on restore
- **Multi-instance ChatProvider** (hidden DOM trees): Memory-heavy, React anti-pattern, poor state sharing

## Architecture

### Data Model

```typescript
interface ChatState {
  chatId: string
  messages: Message[]
  streamingText: string
  isProcessing: boolean
  pendingToolUse: ToolUseItem[]
  chatStatus: 'submitted' | 'streaming' | 'ready' | 'error'
  showInsufficientCredits: boolean
  sseErrorHandled: boolean  // prevents duplicate error messages from send() catch + SSE error
}
```

### Zustand Store (`web/src/stores/chat.ts`)

```typescript
interface ChatStore {
  // State (Record instead of Map for Zustand devtools compatibility)
  chats: Record<string, ChatState>
  activeChatId: string | null

  // Per-chat mutations
  initChat(chatId: string): void
  appendStreamText(chatId: string, text: string): void
  setProcessing(chatId: string, isProcessing: boolean): void
  addToolUse(chatId: string, tool: ToolUseItem): void
  completeMessage(chatId: string, fullText: string, toolUse: ToolUseItem[]): void
  addUserMessage(chatId: string, message: Message): void
  setMessages(chatId: string, messages: Message[]): void
  handleError(chatId: string, error: string, errorCode?: string): void
  removeChat(chatId: string): void
  setShowInsufficientCredits(chatId: string, show: boolean): void
  markSseErrorHandled(chatId: string): void

  // Active chat
  setActiveChatId(chatId: string | null): void
}
```

Key behaviors:
- `chats` is a `Record<string, ChatState>` (plain object, not Map, for Zustand devtools compatibility)
- `activeChatId` is a pointer; switching only changes the pointer
- `chatStatus` state machine — derived within store actions, not via useEffect:
  - `setProcessing(chatId, true)` → sets `chatStatus = 'submitted'`
  - `appendStreamText(chatId, text)` → sets `chatStatus = 'streaming'` (if `isProcessing`)
  - `completeMessage` / `setProcessing(chatId, false)` → sets `chatStatus = 'ready'`
  - `handleError` → sets `chatStatus = 'error'`, then uses `setTimeout(2000)` to reset to `'ready'` (same as current behavior)
- `sseErrorHandled` flag per chat: set to `true` by `handleError`, checked by `send()` catch block to avoid duplicate error messages, reset to `false` at start of each `send()`
- `showInsufficientCredits` per chat: set by `handleError` when `errorCode === 'INSUFFICIENT_CREDITS'`
- Store is a global singleton; sidebar can subscribe to any chat's `isProcessing` via selector

### SSEManager (`web/src/lib/sse-manager.ts`)

A singleton class, independent of React lifecycle.

```typescript
class SSEManager {
  private connections: Map<string, EventSource>
  private lastEventTime: Map<string, number>
  private fallbackTimers: Map<string, ReturnType<typeof setInterval>>

  connect(chatId: string): void     // idempotent: no-op if already connected
  disconnect(chatId: string): void  // close EventSource + clear timers
  disconnectAll(): void             // cleanup on app exit
  isConnected(chatId: string): boolean
}
```

Event routing: SSEManager receives SSE events and dispatches directly to the Zustand store via `useChatStore.getState()`:

- `stream` -> `store.appendStreamText(chatId, text)`
- `tool_use` -> `store.addToolUse(chatId, ...)`
- `complete` -> `store.completeMessage(chatId, ...)` + `this.disconnect(chatId)`
- `processing` -> `store.setProcessing(chatId, ...)` + disconnect if false
- `error` -> `store.handleError(chatId, ...)` + `this.disconnect(chatId)`

Connection lifecycle:
- Created by `send()` action before calling `sendMessage` API
- Auto-closed on `complete`, `error`, or `processing(false)` events
- Fallback timer per connection: polls backend every 5s if no SSE event for 8s (moved from useChat)

### React Hook Layer (`web/src/hooks/useChat.ts`)

The existing `useChat` hook and `useSSE` hook are replaced by three thin hooks:

```typescript
// Read active chat's state (for UI components)
function useActiveChatState(): ChatState | null

// Read specific chat's isProcessing (for sidebar indicators)
function useChatProcessing(chatId: string): boolean

// Actions: send, loadChat, newChat, stop
// Note: agentId is passed to the hook, not to send(), preserving the existing ChatContextType interface
function useChatActions(agentId: string): {
  send(prompt: string, browserProfileId?: string, attachments?: Attachment[]): Promise<void>
  loadChat(chatId: string): Promise<void>
  newChat(): void
  stop(): void
  setShowInsufficientCredits(show: boolean): void
}
```

`send()` flow:
1. Pre-generate chatId if new (`web:${uuid}`)
2. `store.initChat(chatId)` + `store.setActiveChatId(chatId)`
3. Reset `sseErrorHandled` flag for this chat
4. `store.addUserMessage(chatId, msg)`
5. `store.setProcessing(chatId, true)`
6. `sseManager.connect(chatId)`
7. Wait 100ms for EventSource (same race condition fix as current code)
8. Call `sendMessage` API
9. On catch: check `sseErrorHandled` flag — if true, skip (SSE already handled). Otherwise add error message to store. If error matches insufficient credits pattern, set `showInsufficientCredits`.

`loadChat()` flow:
1. `store.setActiveChatId(chatId)`
2. If chat already in store with messages, done (instant switch — including chats that are mid-streaming in the background; their SSE connection is still active and dispatching to the store, so the UI will reactively show current streaming progress)
3. Otherwise fetch from backend, `store.setMessages(chatId, msgs)`

`newChat()` flow:
1. `store.setActiveChatId(null)` — only changes the pointer; any previously active chat that is mid-streaming continues processing in the background via its SSE connection

`stop()` flow:
1. Get activeChatId
2. `sseManager.disconnect(chatId)`
3. `store.setProcessing(chatId, false)` (resets streamingText and pendingToolUse)

### ChatProvider (`web/src/hooks/useChatContext.tsx`)

Simplified to read from store and pass through context:

```typescript
function ChatProvider({ children }) {
  const activeChatState = useActiveChatState()
  const actions = useChatActions(agentId)  // agentId captured here, not exposed to send()
  // chatList, agents, browserProfiles, searchQuery etc. remain unchanged

  return (
    <ChatContext.Provider value={{
      chatId: activeChatState?.chatId ?? null,
      messages: activeChatState?.messages ?? [],
      streamingText: activeChatState?.streamingText ?? '',
      isProcessing: activeChatState?.isProcessing ?? false,
      pendingToolUse: activeChatState?.pendingToolUse ?? [],
      chatStatus: activeChatState?.chatStatus ?? 'ready',
      showInsufficientCredits: activeChatState?.showInsufficientCredits ?? false,
      setShowInsufficientCredits: (show) => {
        const cid = activeChatState?.chatId
        if (cid) store.setShowInsufficientCredits(cid, show)
      },
      ...actions,
      chatList, agents, ...
    }}>
      {children}
    </ChatContext.Provider>
  )
}
```

`ChatContextType` interface remains unchanged. All downstream consumers (`ChatMessages`, `ChatInput`, `ChatWelcome`, etc.) require zero modification.

**`deleteChat` integration**: The existing `deleteChat` logic stays in `ChatProvider` but adds SSE cleanup:
```typescript
const deleteChat = async (chatIdToDelete: string) => {
  await deleteChatApi(chatIdToDelete)
  sseManager.disconnect(chatIdToDelete)  // cleanup SSE if active
  store.removeChat(chatIdToDelete)        // cleanup store entry
  if (store.getState().activeChatId === chatIdToDelete) store.setActiveChatId(null)
  refreshChats()
}
```

**`refreshChats` trigger strategy**: Instead of subscribing to all chats' message counts (which would cause excessive refreshes), `refreshChats` is called:
- On `activeChatId` change (user switches chat)
- Inside `completeMessage` and `addUserMessage` store actions via a callback/subscription — the store exposes an `onChatUpdate` event that ChatProvider subscribes to with a debounced `refreshChats` call (debounce 500ms to batch rapid SSE completions)

### Sidebar Indicator (`web/src/components/chat/ChatListItem.tsx`)

Extracted from inline rendering in `Chat.tsx`. Each item has its own component boundary for precise Zustand selector isolation:

```typescript
function ChatListItem({ chat }: { chat: ChatItem }) {
  const isProcessing = useChatProcessing(chat.chat_id)

  return (
    <div>
      {/* existing avatar, name, time */}
      <p className="...">
        {isProcessing
          ? <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t.chat.thinking}
            </span>
          : chat.last_message || "\u00A0"
        }
      </p>
    </div>
  )
}
```

Performance: each ChatListItem subscribes only to its own chatId's `isProcessing`. Other chats' state changes do not trigger re-renders.

## Edge Cases

| Scenario | Handling |
|----------|----------|
| App closed while streaming | `SSEManager.disconnectAll()` on `beforeunload` (registered in SSEManager module init, not React). Backend continues. Next open: `loadChat` recovers final message from DB. |
| Multiple messages to same chat | Backend AgentQueue ensures per-chat FIFO. Frontend store appends user messages; SSE events arrive in order. |
| Chat deleted while SSE active | `deleteChat` calls `sseManager.disconnect(chatId)` + `store.removeChat(chatId)`. |
| New chat (no chatId yet) | `send()` pre-generates `web:${uuid}`, calls `initChat` then `connect`. Same as current logic. |
| `showInsufficientCredits` dialog | Per-chat `showInsufficientCredits` flag in `ChatState`. Set by `handleError` when `errorCode === 'INSUFFICIENT_CREDITS'`. ChatProvider reads from active chat state and passes through context. |
| SSE connection lost mid-stream | Browser EventSource auto-reconnects. Fallback timer catches stale connections after 8s. |
| SSE error + API error race | Per-chat `sseErrorHandled` flag prevents duplicate error messages. SSE error handler sets flag; `send()` catch checks flag before adding error message. |
| Switch to chat that is streaming in background | `loadChat` finds chat already in store → instant display of current streaming progress. SSE connection continues dispatching to store. |

## Cleanup Strategy

- SSE connections auto-close on `complete`/`error`/`processing(false)`
- Chat state entries in store are NOT proactively cleaned after completion (memory is negligible, enables instant switch-back)
- `removeChat()` is the explicit cleanup path (user deletes chat)

## File Changes

### New files
| File | Purpose |
|------|---------|
| `web/src/stores/chat.ts` | Zustand chat store |
| `web/src/lib/sse-manager.ts` | SSEManager singleton |
| `web/src/components/chat/ChatListItem.tsx` | Extracted sidebar list item |

### Modified files
| File | Change |
|------|--------|
| `web/src/hooks/useChat.ts` | Rewrite: replace single-instance hook with `useActiveChatState` + `useChatActions` + `useChatProcessing` |
| `web/src/hooks/useSSE.ts` | Delete (functionality moved to SSEManager) |
| `web/src/hooks/useChatContext.tsx` | Simplify ChatProvider to read from store |
| `web/src/hooks/chatCtx.ts` | No change (interface preserved) |
| `web/src/pages/Chat.tsx` | Use ChatListItem component for list rendering |

### Unaffected
- All components using `useChatContext()` (ChatMessages, ChatInput, ChatWelcome, AssistantMessage, UserMessage, ToolUseBlock, InsufficientCreditsDialog)
- Backend code (no changes)
- API client (`web/src/api/client.ts`)
- Other pages (Agents, Skills, Memory, Tasks, System)

## Migration

One-shot refactor. The core data flow (`useChat` -> store) cannot be done incrementally. However, because `ChatContextType` interface is preserved, all downstream components are unaffected, keeping the blast radius contained to the hooks/stores layer.
