import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useI18n } from "@/i18n"
import { useAppStore } from "@/stores/app"
import { getCreditTransactions, uploadFile, redeemInvitationCode, type CreditTransaction } from "@/api/client"
import { LogIn, LogOut, Coins, ExternalLink, ChevronRight, Pencil, Camera, Check, X, Loader2, Sparkles, Gift, Copy } from "lucide-react"

export function AccountPanel() {
  const { t } = useI18n()
  const { user, isLoggedIn, authLoading, login, logout, updateProfile, creditBalance, fetchCreditBalance, openPayPage, cloudEnabled } = useAppStore()
  const [transactions, setTransactions] = useState<CreditTransaction[] | null>(null)
  const [logoutOpen, setLogoutOpen] = useState(false)

  // Edit username state
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState("")
  const [savingName, setSavingName] = useState(false)

  // Avatar upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Invitation code state
  const [redeemOpen, setRedeemOpen] = useState(false)
  const [invitationCode, setInvitationCode] = useState("")
  const [redeemingCode, setRedeemingCode] = useState(false)
  const [redeemResult, setRedeemResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    if (!isLoggedIn) return
    fetchCreditBalance()
    let cancelled = false
    getCreditTransactions(20)
      .then((data) => {
        if (!cancelled) setTransactions(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setTransactions([])
      })
    return () => { cancelled = true }
  }, [isLoggedIn, fetchCreditBalance])

  const handleTopUp = async () => {
    await openPayPage()
  }

  const handleLogout = async () => {
    await logout()
    setLogoutOpen(false)
  }

  const handleStartEditName = () => {
    setNameValue(user?.name ?? "")
    setEditingName(true)
  }

  const handleSaveName = async () => {
    if (!nameValue.trim()) return
    setSavingName(true)
    try {
      await updateProfile({ displayName: nameValue.trim() })
      setEditingName(false)
    } catch (err) {
      console.error("Failed to update name:", err)
    }
    setSavingName(false)
  }

  const handleCancelEditName = () => {
    setEditingName(false)
  }

  const handleRedeem = async () => {
    if (!invitationCode.trim()) return
    setRedeemingCode(true)
    setRedeemResult(null)
    try {
      await redeemInvitationCode(invitationCode.trim())
      setRedeemResult({ success: true, message: t.account.redeemSuccess })
      setInvitationCode("")
      // Refresh credit balance
      fetchCreditBalance()
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : '') || ''
      const errorMap: Record<string, string> = {
        CODE_NOT_FOUND: t.account.redeemErrorCodeNotFound,
        REFERRAL_ALREADY_USED: t.account.redeemErrorAlreadyUsed,
      }
      const matched = Object.keys(errorMap).find(key => msg.includes(key))
      setRedeemResult({ success: false, message: matched ? errorMap[matched] : (msg || t.account.redeemFailed) })
    }
    setRedeemingCode(false)
  }

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingAvatar(true)
    try {
      const url = await uploadFile(file)
      await updateProfile({ avatar: url })
    } catch (err) {
      console.error("Failed to upload avatar:", err)
    }
    setUploadingAvatar(false)
    // Clear input to allow re-selecting the same file
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Offline mode: cloud service not configured
  if (!cloudEnabled) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-20">
        <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">
          <LogIn size={32} className="text-muted-foreground" />
        </div>
        <div className="text-center space-y-2">
          <div className="text-muted-foreground text-sm">{t.account.offlineMode}</div>
          <p className="text-xs text-muted-foreground">{t.account.offlineModeHint}</p>
        </div>
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-20">
        <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center">
          <LogIn size={32} className="text-primary" />
        </div>
        <div className="text-center space-y-2">
          <div className="text-muted-foreground text-sm">{t.account.notLoggedIn}</div>
          <p className="text-xs text-muted-foreground">{t.account.loginHint}</p>
        </div>
        <Button onClick={login} disabled={authLoading} size="lg" className="gap-2 rounded-xl px-8">
          <LogIn size={16} />
          {authLoading ? t.account.loggingIn : t.account.login}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* User info: large avatar + username/email/badge */}
      <div className="flex items-center gap-6">
        <div className="relative group cursor-pointer shrink-0" onClick={handleAvatarClick}>
          {uploadingAvatar ? (
            <div className="w-24 h-24 rounded-3xl bg-muted flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : user?.avatar ? (
            <img src={user.avatar} alt={user.name} className="w-24 h-24 rounded-3xl object-cover shadow-xl" />
          ) : (
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-3xl font-bold text-primary-foreground shadow-xl">
              {user?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          {/* Avatar hover overlay */}
          <div className="absolute inset-0 rounded-3xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Camera size={20} className="text-white" />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
        </div>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName()
                  if (e.key === "Escape") handleCancelEditName()
                }}
                className="h-8 text-base font-semibold"
                autoFocus
                disabled={savingName}
              />
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleSaveName} disabled={savingName || !nameValue.trim()}>
                {savingName ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleCancelEditName} disabled={savingName}>
                <X size={14} />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group/name">
              <h4 className="text-xl font-bold truncate">{user?.name}</h4>
              <button
                onClick={handleStartEditName}
                className="opacity-0 group-hover/name:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
              >
                <Pencil size={13} className="text-muted-foreground" />
              </button>
            </div>
          )}
          {user?.email && <p className="text-sm text-muted-foreground truncate mt-0.5">{user.email}</p>}
          {user?.id && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs text-muted-foreground font-mono">ID: {user.id}</span>
              <button
                onClick={() => navigator.clipboard.writeText(user.id)}
                className="p-0.5 rounded hover:bg-muted transition-colors"
                title="Copy ID"
              >
                <Copy size={11} className="text-muted-foreground" />
              </button>
            </div>
          )}
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-primary/15 text-primary rounded-full text-[10px] font-bold uppercase tracking-wider">
            <Sparkles size={10} />
            Pro Member
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setLogoutOpen(true)} className="gap-1.5 rounded-xl shrink-0">
          <LogOut size={14} />
          {t.account.logout}
        </Button>
      </div>

      {/* Credit balance card */}
      <div className="rounded-2xl border-2 border-border p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{t.account.creditBalance}</div>
            <div className="text-3xl font-bold mt-2 flex items-center gap-2">
              <Coins size={24} className="text-amber-500" />
              {creditBalance != null ? creditBalance.toLocaleString() : '--'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => { setRedeemResult(null); setInvitationCode(""); setRedeemOpen(true) }} className="gap-1.5 rounded-xl">
              <Gift size={14} />
              {t.account.invitationCode}
            </Button>
            <Button onClick={handleTopUp} className="gap-1.5 rounded-xl">
              <ExternalLink size={14} />
              {t.account.topUp}
            </Button>
          </div>
        </div>
      </div>

      {/* Credit transactions */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          {t.account.transactions}
        </h4>
        {transactions === null ? (
          <div className="text-sm text-muted-foreground text-center py-4">{t.common.loading}</div>
        ) : transactions.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed rounded-2xl">
            {t.common.noData}
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between p-4 rounded-2xl border border-border hover:border-muted-foreground/20 transition-all cursor-pointer group">
                <div className="min-w-0 flex-1 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Coins size={14} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{tx.description || tx.type}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(tx.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold shrink-0 ${tx.amount >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {tx.amount >= 0 ? '+' : ''}{tx.amount}
                  </span>
                  <ChevronRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invitation code dialog */}
      <Dialog open={redeemOpen} onOpenChange={setRedeemOpen}>
        <DialogContent className="sm:max-w-sm p-8">
          <div className="flex flex-col items-center text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Gift size={24} className="text-primary" />
            </div>
            <DialogHeader className="space-y-1.5 items-center">
              <DialogTitle>{t.account.invitationCode}</DialogTitle>
              <DialogDescription>{t.account.invitationCodePlaceholder}</DialogDescription>
            </DialogHeader>
            <Input
              value={invitationCode}
              onChange={(e) => {
                setInvitationCode(e.target.value)
                setRedeemResult(null)
              }}
              onKeyDown={(e) => { if (e.key === "Enter") handleRedeem() }}
              placeholder={t.account.invitationCodePlaceholder}
              className="text-center tracking-widest text-base h-11"
              disabled={redeemingCode}
              autoFocus
            />
            {redeemResult && (
              <div className={`text-sm w-full px-3 py-2.5 rounded-xl ${redeemResult.success ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                {redeemResult.message}
              </div>
            )}
            <Button
              onClick={handleRedeem}
              disabled={redeemingCode || !invitationCode.trim()}
              className="w-full gap-2 rounded-xl h-11"
            >
              {redeemingCode ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} />}
              {redeemingCode ? t.account.redeeming : t.account.redeem}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Logout confirmation dialog */}
      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.account.logout}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.account.logoutConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogout}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.account.logout}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
