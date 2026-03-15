import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
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

export function ChatMessages() {
  const { t } = useI18n()
  const { messages, streamingText, isProcessing, pendingToolUse } = useChatContext()

  return (
    <Conversation data-testid="message-list">
      <ConversationContent className="max-w-3xl mx-auto w-full px-4 py-6 gap-1">
        {messages.map(msg =>
          msg.role === 'user'
            ? <UserMessage key={msg.id} message={msg} />
            : <AssistantMessage key={msg.id} message={msg} />
        )}

        {/* Streaming tool_use */}
        {pendingToolUse.length > 0 && (
          <AIMessage from="assistant">
            <div className="flex gap-3 py-3">
              <Avatar className="h-8 w-8 mt-0.5">
                <AvatarImage src="/icon.svg" alt="YouClaw" />
                <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-purple-500/20 text-[10px] font-semibold">
                  AI
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <ToolUseBlock items={pendingToolUse} />
              </div>
            </div>
          </AIMessage>
        )}

        {/* Streaming text */}
        {streamingText && (
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
                  <MessageResponse parseIncompleteMarkdown>{streamingText}</MessageResponse>
                </MessageContent>
              </div>
            </div>
          </AIMessage>
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
        <ScrollOnChange messageCount={messages.length} isProcessing={isProcessing} />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
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
