import { useEffect } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import {
  Message as AIMessage,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { ToolUseBlock } from './ToolUseBlock'
import { useI18n } from '@/i18n'
import { useChatContext } from '@/hooks/chatCtx'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TimelineItem } from '@/hooks/useChat'
import { buildRenderableTimeline, type RenderableTimelineItem } from './timeline'

export function ChatMessages() {
  const { t } = useI18n()
  const { timelineItems, streamingText, isProcessing, pendingToolUse } = useChatContext()
  const renderableItems = buildRenderableTimeline(timelineItems)

  return (
    <Conversation data-testid="message-list">
      <ConversationContent className="max-w-3xl mx-auto w-full px-4 py-6 gap-1">
        {renderableItems.map((item) =>
          <TimelineRow key={item.id} item={item} />
        )}

        {/* Thinking state */}
        {isProcessing && !streamingText && pendingToolUse.length === 0 && (
          <div className="flex gap-3 py-3">
            <Avatar className="h-8 w-8 mt-0.5">
              <AvatarImage src="/icon.svg" alt="YouClaw" />
              <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-purple-500/20 text-[10px] font-semibold">
                AI
              </AvatarFallback>
            </Avatar>
            <div className="flex items-center gap-2 text-muted-foreground text-sm pt-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.chat.thinking}
            </div>
          </div>
        )}
        <ScrollOnChange messageCount={renderableItems.length} isProcessing={isProcessing} />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}

function TimelineRow({ item }: { item: RenderableTimelineItem }) {
  if (item.kind === 'tool_use_group') {
    return <ToolUseTimelineGroup items={item.items} />
  }

  switch (item.kind) {
    case 'message':
      return item.role === 'user'
        ? <UserMessage message={item} />
        : <AssistantMessage message={item} />
    case 'assistant_stream':
      return <StreamingAssistantItem content={item.content} />
    case 'document_status':
      return <DocumentStatusTimelineItem item={item} />
  }
}

function StreamingAssistantItem({ content }: { content: string }) {
  const { t } = useI18n()

  return (
    <AIMessage from="assistant">
      <div className="flex gap-3 py-3">
        <Avatar className="h-8 w-8 mt-0.5">
          <AvatarImage src="/icon.svg" alt="YouClaw" />
          <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-purple-500/20 text-[10px] font-semibold">
            AI
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">{t.chat.assistant}</div>
          <MessageContent>
            <MessageResponse parseIncompleteMarkdown>{content}</MessageResponse>
          </MessageContent>
        </div>
      </div>
    </AIMessage>
  )
}

function ToolUseTimelineGroup({ items }: { items: Array<{ id: string; name: string; input?: string; status: 'running' | 'done' }> }) {
  return (
    <AIMessage from="assistant">
      <div className="flex gap-3 py-2">
        <Avatar className="h-8 w-8 mt-0.5">
          <AvatarImage src="/icon.svg" alt="YouClaw" />
          <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-purple-500/20 text-[10px] font-semibold">
            AI
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <ToolUseBlock items={items} />
        </div>
      </div>
    </AIMessage>
  )
}

function DocumentStatusTimelineItem({ item }: { item: Extract<TimelineItem, { kind: 'document_status' }> }) {
  return (
    <AIMessage from="assistant">
      <div className="flex gap-3 py-2">
        <Avatar className="h-8 w-8 mt-0.5">
          <AvatarImage src="/icon.svg" alt="YouClaw" />
          <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-purple-500/20 text-[10px] font-semibold">
            AI
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 rounded-xl border border-border/70 bg-muted/30 px-3 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
            <FileText className="h-3.5 w-3.5" />
            Document processing
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-foreground break-all">{item.filename}</span>
            <Badge
              variant="outline"
              className={cn(
                'capitalize',
                item.status === 'parsing' && 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
                item.status === 'parsed' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
                item.status === 'failed' && 'border-red-500/30 bg-red-500/10 text-red-300',
              )}
            >
              {item.status}
            </Badge>
            {item.error && (
              <span className="text-xs text-muted-foreground break-all">{item.error}</span>
            )}
          </div>
        </div>
      </div>
    </AIMessage>
  )
}

/** Auto-scroll to bottom when message count changes or processing starts */
function ScrollOnChange({ messageCount, isProcessing }: { messageCount: number; isProcessing: boolean }) {
  const { scrollToBottom } = useStickToBottomContext()

  useEffect(() => {
    scrollToBottom()
  }, [messageCount, isProcessing, scrollToBottom])

  return null
}
