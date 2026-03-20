import { useState } from "react"
import { useI18n } from "@/i18n"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Loader2, Mail, Github } from "lucide-react"
import logoUrl from "@/assets/logo.png"

const GITHUB_URL = "https://github.com/CodePhiliaX/youClaw"
const SUPPORT_EMAIL = "support@chat2db-ai.com"

interface StartupErrorProps {
  onRetry: () => void
}

export function StartupError({ onRetry }: StartupErrorProps) {
  const { t } = useI18n()
  const [retrying, setRetrying] = useState(false)

  const handleRetry = () => {
    setRetrying(true)
    onRetry()
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-background to-muted/30">
      <div className="flex-1 flex items-center justify-center overflow-auto p-8">
        <div className="w-full max-w-lg space-y-8">
          {/* Logo & Title */}
          <div className="text-center">
            <div className="inline-block transition-transform hover:scale-105 duration-300">
              <img
                src={logoUrl}
                alt="YouClaw Logo"
                className="w-20 h-20 p-2 mx-auto rounded-2xl shadow-lg border border-border/50 bg-white"
              />
            </div>
            <h1 className="mt-5 text-2xl font-bold text-foreground tracking-tight">YouClaw</h1>
          </div>

          {/* Error Card */}
          <div className="bg-card rounded-2xl shadow-lg border border-border/50 p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="bg-destructive/10 p-2.5 rounded-xl text-destructive shrink-0 mt-0.5">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t.startupError.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  {t.startupError.description}
                </p>
              </div>
            </div>

            {/* Retry Button */}
            <Button
              size="lg"
              onClick={handleRetry}
              disabled={retrying}
              className="w-full gap-2 py-6 text-sm font-semibold rounded-xl shadow-lg shadow-primary/20 active:scale-[0.98] transition-all duration-200"
            >
              {retrying ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {t.startupError.retrying}
                </>
              ) : (
                t.common.retry
              )}
            </Button>

            {/* Contact Info */}
            <div className="pt-3 border-t border-border/50 space-y-2">
              <p className="text-xs text-muted-foreground text-center">{t.startupError.contactHint}</p>
              <div className="flex items-center justify-center gap-4">
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Mail size={14} />
                  <span>{SUPPORT_EMAIL}</span>
                </a>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Github size={14} />
                  <span>GitHub</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
