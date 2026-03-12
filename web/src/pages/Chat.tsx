import { useChatContext } from '@/hooks/useChatContext'
import { ChatWelcome } from '@/components/chat/ChatWelcome'
import { ChatMessages } from '@/components/chat/ChatMessages'
import { ChatInput } from '@/components/chat/ChatInput'

export function Chat() {
  const { chatId, messages } = useChatContext()
  const isNewChat = !chatId && messages.length === 0

  return (
    <div className="flex flex-col h-full">
      {isNewChat ? (
        <ChatWelcome />
      ) : (
        <>
          <ChatMessages />
          <ChatInput />
        </>
      )}
    </div>
  )
}
