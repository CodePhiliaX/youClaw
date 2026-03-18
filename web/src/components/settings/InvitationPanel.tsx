import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"
import { useAppStore } from "@/stores/app"
import { getReferralCode, getReferralStats, type ReferralCode, type ReferralStats } from "@/api/client"
import { Copy, Check, Users, Coins, Loader2, UserPlus, Gift } from "lucide-react"

export function InvitationPanel() {
  const { t } = useI18n()
  const { isLoggedIn, cloudEnabled } = useAppStore()
  const [referralCode, setReferralCode] = useState<ReferralCode | null>(null)
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [code, statsData] = await Promise.all([
        getReferralCode(),
        getReferralStats(),
      ])
      setReferralCode(code)
      setStats(statsData)
    } catch {
      // ignore
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isLoggedIn && cloudEnabled) {
      fetchData()
    }
  }, [isLoggedIn, cloudEnabled, fetchData])

  const handleCopy = async () => {
    if (!referralCode?.code) return
    await navigator.clipboard.writeText(referralCode.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!cloudEnabled || !isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-20">
        <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">
          <UserPlus size={32} className="text-muted-foreground" />
        </div>
        <div className="text-center space-y-2">
          <div className="text-muted-foreground text-sm">{t.account.notLoggedIn}</div>
          <p className="text-xs text-muted-foreground">{t.account.loginHint}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Referral code card */}
      <div className="rounded-2xl border-2 border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Gift size={20} className="text-primary" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">{t.invitation.referralCode}</h4>
            <p className="text-xs text-muted-foreground">{t.invitation.referralCodeHint}</p>
          </div>
        </div>
        {referralCode?.code ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-muted rounded-xl px-4 py-3 font-mono text-lg tracking-[0.2em] text-center select-all">
              {referralCode.code}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="gap-1.5 rounded-xl shrink-0"
            >
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {copied ? t.invitation.copied : t.invitation.copyCode}
            </Button>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            {t.invitation.loadFailed}
          </div>
        )}
      </div>

      {/* Stats cards */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          {t.invitation.stats}
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users size={16} className="text-blue-500" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{t.invitation.totalInvited}</span>
            </div>
            <div className="text-2xl font-bold">
              {stats?.invitedCount ?? 0}
              <span className="text-sm font-normal text-muted-foreground ml-1">{t.invitation.people}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-border p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Coins size={16} className="text-amber-500" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{t.invitation.totalCreditsEarned}</span>
            </div>
            <div className="text-2xl font-bold">
              {(stats?.totalCredits ?? 0).toLocaleString()}
              {stats?.maxCredits ? (
                <span className="text-sm font-normal text-muted-foreground ml-1">/ {stats.maxCredits.toLocaleString()}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
