import { useEffect, useState } from "react"
import { useI18n } from "@/i18n"
import { useAppStore } from "@/stores/app"
import { LogIn, Loader2, Calendar, MessageSquare, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isTauri } from "@/api/transport"
import { useDragRegion } from "@/hooks/useDragRegion"
import logoUrl from "@/assets/logo.png"

export function Login() {
  const { t, locale, setLocale } = useI18n()
  const { authLoading, login } = useAppStore()
  const [version, setVersion] = useState("")
  const drag = useDragRegion()

  useEffect(() => {
    if (!isTauri) return
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<string>("get_version").then((v) => setVersion("v" + v))
    })
  }, [])

  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-background to-muted/30">
      <div className="flex-1 flex overflow-hidden">
        {/* Left hero area - large screens only, draggable */}
        <section
          className="hidden lg:flex flex-1 flex-col p-12 relative border-r border-border/50 bg-gradient-to-br from-background via-primary/5 to-background"
          {...drag}
        >
          {/* Decorative elements */}
          <div className="absolute top-20 right-10 w-32 h-32 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-10 w-48 h-48 bg-muted/40 rounded-full blur-3xl" />

          <header className="mb-auto relative z-10">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              {t.login.heroTitle}
            </h2>
            <p className="mt-2 text-muted-foreground max-w-sm">
              {t.login.heroDesc}
            </p>
          </header>

          {/* Feature cards */}
          <div className="flex-grow flex items-center justify-center py-10 relative z-10">
            <div className="relative w-full max-w-sm">
              <div className="animate-[float_6s_ease-in-out_infinite]">
                <div className="bg-card p-5 rounded-2xl shadow-lg border border-border/50 flex items-center gap-4 mb-5 translate-x-12">
                  <div className="bg-primary/10 p-3 rounded-xl text-primary shrink-0">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">{t.login.featureSchedule}</p>
                    <p className="text-xs text-muted-foreground">{t.login.featureScheduleDesc}</p>
                  </div>
                </div>

                <div className="bg-card p-5 rounded-2xl shadow-lg border border-border/50 flex items-center gap-4 mb-5 -translate-x-4">
                  <div className="bg-blue-500/10 p-3 rounded-xl text-blue-500 shrink-0">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">{t.login.featureChat}</p>
                    <p className="text-xs text-muted-foreground">{t.login.featureChatDesc}</p>
                  </div>
                </div>

                <div className="bg-card p-5 rounded-2xl shadow-lg border border-border/50 flex items-center gap-4 translate-x-8">
                  <div className="bg-green-500/10 p-3 rounded-xl text-green-500 shrink-0">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">{t.login.featureIntegration}</p>
                    <p className="text-xs text-muted-foreground">{t.login.featureIntegrationDesc}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <footer className="mt-auto flex gap-6 text-xs font-medium text-muted-foreground relative z-10">
            <span>&copy; 2026 YouClaw</span>
          </footer>
        </section>

        {/* Right: Login area */}
        <section className="w-full lg:w-[420px] flex flex-col items-center justify-between p-8 md:p-12 bg-card">
          <div className="w-full text-center mt-8">
            <div className="inline-block transition-transform hover:scale-105 duration-300">
              <img
                src={logoUrl}
                alt="YouClaw Logo"
                className="w-28 h-28 p-3 mx-auto rounded-3xl shadow-lg border border-border/50 bg-white"
              />
            </div>
            <h1 className="mt-6 text-2xl font-bold text-foreground tracking-tight">YouClaw</h1>
            <p className="text-muted-foreground text-sm mt-1">{t.login.subtitle}</p>
          </div>

          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <p className="text-muted-foreground mb-8 text-sm">
                {t.account.loginHint}
              </p>

              <Button
                size="lg"
                onClick={() => login()}
                disabled={authLoading}
                className="w-full gap-2 py-6 text-sm font-semibold rounded-xl shadow-lg shadow-primary/20 active:scale-[0.98] transition-all duration-200"
              >
                {authLoading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {t.account.loggingIn}
                  </>
                ) : (
                  <>
                    <LogIn size={18} />
                    {t.login.continueLogin}
                  </>
                )}
              </Button>

              <p className="mt-4 text-xs text-muted-foreground">
                {t.login.redirectHint}
              </p>
            </div>

            <div className="pt-6 border-t border-border/50 text-center">
              <button
                type="button"
                onClick={() => setLocale(locale === "en" ? "zh" : "en")}
                className="px-4 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {locale === "en" ? "中文" : "English"}
              </button>
            </div>
          </div>

          <div className="w-full text-center">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              {isTauri ? version : t.settings.webVersion}
            </span>
          </div>
        </section>

        <style>{`
          @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
          }
        `}</style>
      </div>
    </div>
  )
}
