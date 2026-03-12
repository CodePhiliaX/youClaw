import { Sparkles } from 'lucide-react'
import { useI18n } from '@/i18n'
import { ChatInput } from './ChatInput'

export function ChatWelcome() {
  const { t } = useI18n()

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="max-w-xl w-full space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 mb-2">
            <Sparkles className="h-7 w-7 text-primary opacity-80" />
          </div>
          <h1 className="text-2xl font-semibold">{t.chat.welcome}</h1>
          <p className="text-sm text-muted-foreground">{t.chat.startHint}</p>
        </div>

        <ChatInput />
      </div>
    </div>
  )
}
