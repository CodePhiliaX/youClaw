import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'

export function GlobalBubble() {
  const { t } = useI18n()
  const bubble = useAppStore((state) => state.globalBubble)
  const dismissGlobalBubble = useAppStore((state) => state.dismissGlobalBubble)

  useEffect(() => {
    if (!bubble) return

    const timer = window.setTimeout(() => {
      dismissGlobalBubble()
    }, bubble.durationMs)

    return () => window.clearTimeout(timer)
  }, [bubble, dismissGlobalBubble])

  if (!bubble || typeof document === 'undefined') {
    return null
  }

  const isSuccess = bubble.type === 'success'

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex justify-center px-4 pt-4 sm:px-6 sm:pt-6">
      <div
        role={isSuccess ? 'status' : 'alert'}
        aria-live={isSuccess ? 'polite' : 'assertive'}
        className={cn(
          'pointer-events-auto inline-flex w-fit max-w-[min(calc(100vw-2rem),52rem)] items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-md sm:max-w-[min(calc(100vw-3rem),56rem)]',
          isSuccess
            ? 'border-green-500/30 bg-green-500/12 text-green-300'
            : 'border-red-500/30 bg-red-500/12 text-red-300',
        )}
      >
        {isSuccess ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 break-words leading-6">{bubble.message}</span>
        <button
          type="button"
          onClick={dismissGlobalBubble}
          className="shrink-0 rounded-full p-1 text-current/70 transition-colors hover:bg-black/10 hover:text-current"
          aria-label={t.common.close}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>,
    document.body,
  )
}
