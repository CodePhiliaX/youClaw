import { Sparkles } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useChatContext } from '@/hooks/useChatContext'
import { ChatWelcome } from '@/components/chat/ChatWelcome'
import { ChatMessages } from '@/components/chat/ChatMessages'
import { ChatInput } from '@/components/chat/ChatInput'

export function Chat() {
  const { t } = useI18n()
  const { chatId, messages } = useChatContext()
  const isNewChat = !chatId && messages.length === 0

  return (
    <div className="flex flex-col h-full relative">
      {isNewChat ? (
        <ChatWelcome />
      ) : (
        <ChatMessages />
      )}

      {/* ChatInput 始终渲染，通过位置动画从居中移到底部 */}
      <div
        className={
          isNewChat
            ? 'absolute inset-x-0 top-1/2 -translate-y-1/2 px-4 transition-all duration-500 ease-out'
            : 'relative px-0 transition-all duration-500 ease-out'
        }
      >
        <div className="max-w-3xl mx-auto">
          {/* 欢迎提示文字，发送后淡出 */}
          <div className={
            isNewChat
              ? 'text-center space-y-3 mb-6 opacity-100 transition-opacity duration-300'
              : 'text-center space-y-3 mb-0 opacity-0 h-0 overflow-hidden transition-all duration-300'
          }>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 mb-2">
              <Sparkles className="h-7 w-7 text-primary opacity-80" />
            </div>
            <h1 className="text-2xl font-semibold">{t.chat.welcome}</h1>
            <p className="text-sm text-muted-foreground">{t.chat.startHint}</p>
          </div>
          <ChatInput />
        </div>
      </div>
    </div>
  )
}
