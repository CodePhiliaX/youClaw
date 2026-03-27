import { openExternal } from "@/api/transport";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDragRegion } from "@/hooks/useDragRegion";
import { usePlatform } from "@/hooks/usePlatform";
import { useSidebar } from "@/hooks/useSidebar";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useAppRuntimeStore } from "@/stores/app";
import {
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  ChevronRight,
  Gift,
  Github,
  LogIn,
  LogOut,
  Mail,
  PanelLeft,
  PanelLeftClose,
  Puzzle,
  ScrollText,
  Settings2,
  SquarePen,
  User,
} from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";

/** Inline horizontal padding, keeps icon centered within 52px when collapsed (8+36+8=52) */
const ROW_PX = "px-2";
const FEEDBACK_URL_ZH =
  "https://j12x8oxkydy.feishu.cn/share/base/form/shrcnoxGY5WZqwdPyROFLGTuNuc";
const FEEDBACK_URL_EN =
  "https://j12x8oxkydy.feishu.cn/share/base/form/shrcngmxMuqrhdUiW3P5UFQi5Fc";

function AvatarView({
  size = "md",
  user,
  isLoggedIn,
}: {
  size?: "sm" | "md";
  user: { name: string; avatar?: string } | null;
  isLoggedIn: boolean;
}) {
  const sizeClass = size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";

  if (isLoggedIn && user?.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.name}
        className={cn("rounded-full object-cover", sizeClass)}
      />
    );
  }
  if (isLoggedIn && user) {
    return (
      <div
        className={cn(
          "rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground font-bold",
          sizeClass,
        )}
      >
        {user.name?.[0]?.toUpperCase() ?? "?"}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "rounded-full bg-muted flex items-center justify-center text-muted-foreground",
        sizeClass,
      )}
    >
      <User className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />
    </div>
  );
}

interface AppSidebarProps {
  onOpenSettings: (tab?: string) => void;
}

export function AppSidebar({ onOpenSettings }: AppSidebarProps) {
  const { isCollapsed, toggle } = useSidebar();
  const { t } = useI18n();
  const { user, isLoggedIn, authLoading, login, logout, cloudEnabled } =
    useAppRuntimeStore();
  const { isMac } = usePlatform();
  const drag = useDragRegion();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const feedbackUrl =
    typeof navigator !== "undefined" &&
    navigator.language.toLowerCase().startsWith("zh")
      ? FEEDBACK_URL_ZH
      : FEEDBACK_URL_EN;

  const navItems = [
    { to: "/", icon: SquarePen, label: t.nav.chat },
    { to: "/agents", icon: Bot, label: t.nav.agents },
    { to: "/cron", icon: CalendarClock, label: t.nav.tasks },
    { to: "/skills", icon: Puzzle, label: t.nav.skills },
    { to: "/memory", icon: Brain, label: t.nav.memory },
    { to: "/logs", icon: ScrollText, label: t.nav.logs },
  ];

  const displayName =
    isLoggedIn && user
      ? user.name
      : cloudEnabled
        ? t.account.notLoggedIn
        : t.account.offlineMode;
  const displaySub =
    isLoggedIn && user
      ? "Pro Plan"
      : cloudEnabled
        ? t.account.loginHint
        : t.account.offlineModeHint;

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col overflow-hidden",
        "bg-muted/30 border-r",
        "border-[var(--subtle-border)]",
        "transition-[width] duration-300 ease-[var(--ease-soft)]",
        isCollapsed ? "w-[52px]" : "w-[220px]",
      )}
      aria-expanded={!isCollapsed}
    >
      {/* Top action bar */}
      {!isMac ? (
        <div className={cn("flex items-center h-[52px] shrink-0", ROW_PX)}>
          {isCollapsed ? (
            <button
              type="button"
              onClick={toggle}
              className="w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center hover:bg-[var(--surface-hover)] transition-all duration-200 ease-[var(--ease-soft)]"
              aria-label={t.sidebar.expand}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5 ml-1.5 mr-1">
              <img src="/icon.svg" alt="YouClaw" className="h-5 w-5" />
              <span className="text-md font-semibold tracking-tight whitespace-nowrap text-primary">
                YouClaw
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0" />
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center hover:bg-[var(--surface-hover)] transition-all duration-200 ease-[var(--ease-soft)]",
              isCollapsed ? "opacity-0 pointer-events-none" : "opacity-100",
            )}
            aria-label={t.sidebar.collapse}
            tabIndex={isCollapsed ? -1 : 0}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div
          className={cn("flex items-center h-10 shrink-0", ROW_PX)}
          {...drag}
        >
          {isCollapsed ? (
            <button
              type="button"
              onClick={toggle}
              className="w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center hover:bg-[var(--surface-hover)] transition-all duration-200 ease-[var(--ease-soft)]"
              aria-label={t.sidebar.expand}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-1.5 ml-1.5 mr-1 min-w-0">
                <img
                  src="/icon.svg"
                  alt="YouClaw"
                  className="h-5 w-5 shrink-0"
                />
                <span className="text-md font-semibold tracking-tight whitespace-nowrap text-primary truncate">
                  YouClaw
                </span>
              </div>
              <div className="flex-1 min-w-0" />
              <button
                type="button"
                onClick={toggle}
                className="w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center hover:bg-[var(--surface-hover)] transition-all duration-200 ease-[var(--ease-soft)]"
                aria-label={t.sidebar.collapse}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Page navigation */}
      <nav className="space-y-0.5 px-1.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            data-testid={`nav-${item.to === "/" ? "chat" : item.to.slice(1)}`}
            className={({ isActive }) =>
              cn(
                "flex items-center h-9 rounded-[10px] whitespace-nowrap overflow-hidden",
                "transition-all duration-200 ease-[var(--ease-soft)]",
                isCollapsed ? "px-0.5" : "px-1",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-[var(--surface-hover)]",
              )
            }
            aria-label={item.label}
          >
            <div className="w-9 h-9 shrink-0 flex items-center justify-center">
              <item.icon className="h-4 w-4" />
            </div>
            <span
              className={cn(
                "text-sm transition-opacity duration-200",
                isCollapsed ? "opacity-0" : "opacity-100",
              )}
            >
              {item.label}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Spacer — draggable for window movement */}
      <div className="flex-1" {...drag} />

      {/* Bottom actions */}
      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <div className="border-t border-[var(--subtle-border)] py-2 px-1.5 space-y-2">
          <button
            type="button"
            onClick={() => onOpenSettings("invitation")}
            className={cn(
              "relative flex w-full items-center overflow-hidden text-left",
              "transition-[background-color,border-color] duration-300 ease-[var(--ease-soft)]",
              isCollapsed
                ? "h-10 justify-center rounded-[10px] border border-transparent bg-transparent px-0.5 text-primary hover:bg-[var(--surface-hover)]"
                : "sidebar-invitation-card h-14 justify-start rounded-[14px] border border-primary/15 bg-gradient-to-br from-primary/10 via-background to-amber-500/8 px-3",
            )}
            aria-label={t.sidebar.invitationReward}
            title={t.sidebar.invitationReward}
          >
            <div
              className={cn(
                "relative z-[1] flex w-full items-center",
                isCollapsed ? "justify-center" : "justify-start",
              )}
            >
              <Gift
                className={cn(
                  "shrink-0",
                  isCollapsed
                    ? "h-[18px] w-[18px]"
                    : "h-[18px] w-[18px] text-primary",
                )}
              />
              <div
                className={cn(
                  "min-w-0 overflow-hidden transition-[max-width,opacity,transform,margin] duration-300 ease-[var(--ease-soft)]",
                  isCollapsed
                    ? "ml-0 max-w-0 translate-x-1.5 opacity-0"
                    : "ml-2.5 max-w-[134px] translate-x-0 opacity-100",
                )}
              >
                <p className="truncate text-[12px] font-medium leading-[1.1] text-foreground">
                  {t.sidebar.invitationTitle}
                </p>
                <p className="mt-1 truncate text-[11px] font-medium leading-none text-muted-foreground">
                  {t.sidebar.invitationSubtitle}
                </p>
              </div>
              <div
                className={cn(
                  "overflow-hidden transition-[max-width,opacity,transform,margin] duration-300 ease-[var(--ease-soft)]",
                  isCollapsed
                    ? "ml-0 max-w-0 translate-x-1 opacity-0"
                    : "ml-auto max-w-4 translate-x-0 opacity-70",
                )}
              >
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          </button>

          <DropdownMenu>
            <div
              className={cn(
                "flex items-center gap-1",
                isCollapsed && "justify-center",
              )}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex items-center h-9 rounded-[10px] whitespace-nowrap overflow-hidden outline-none",
                    "transition-all duration-200 ease-[var(--ease-soft)]",
                    isCollapsed ? "w-full px-0.5" : "min-w-0 flex-1 px-1",
                    "text-muted-foreground hover:text-foreground hover:bg-[var(--surface-hover)]",
                  )}
                >
                  <div className="w-9 h-9 shrink-0 flex items-center justify-center">
                    <AvatarView size="md" user={user} isLoggedIn={isLoggedIn} />
                  </div>
                  <div
                    className={cn(
                      "flex-1 min-w-0 text-left ml-1.5 transition-opacity duration-200",
                      isCollapsed ? "opacity-0" : "opacity-100",
                    )}
                  >
                    <p className="text-xs font-semibold truncate">
                      {isLoggedIn && user
                        ? user.name
                        : cloudEnabled
                          ? t.account.login
                          : t.account.offlineMode}
                    </p>
                    {isLoggedIn && user && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        Pro Plan
                      </p>
                    )}
                  </div>
                </button>
              </DropdownMenuTrigger>

              {!isCollapsed && (
                <button
                  type="button"
                  onClick={() => void openExternal(feedbackUrl)}
                  className="h-9 shrink-0 rounded-[10px] px-2.5 text-xs font-medium text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground transition-all duration-200 ease-[var(--ease-soft)]"
                  aria-label={t.sidebar.feedback}
                  title={t.sidebar.feedback}
                >
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-4 w-4 shrink-0" />
                    <span>{t.sidebar.feedback}</span>
                  </span>
                </button>
              )}
            </div>

            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-[240px] rounded-xl p-2"
            >
              <div className="flex flex-col items-center py-3 px-2">
                <div className="mb-2">
                  <AvatarView size="md" user={user} isLoggedIn={isLoggedIn} />
                </div>
                <p className="text-sm font-semibold truncate max-w-full">
                  {displayName}
                </p>
                <p className="text-[11px] text-muted-foreground truncate max-w-full">
                  {displaySub}
                </p>
              </div>

              <DropdownMenuSeparator />

              {cloudEnabled && !isLoggedIn && (
                <>
                  <DropdownMenuItem
                    onClick={() => login()}
                    disabled={authLoading}
                    className="gap-3 px-3 py-2.5 rounded-lg cursor-pointer"
                  >
                    <LogIn className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {authLoading ? t.account.loggingIn : t.account.login}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              <DropdownMenuItem
                onClick={() => onOpenSettings()}
                className="gap-3 px-3 py-2.5 rounded-lg cursor-pointer"
              >
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{t.settings.title}</span>
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() =>
                  openExternal("https://github.com/CodePhiliaX/youClaw")
                }
                className="gap-3 px-3 py-2.5 rounded-lg cursor-pointer"
              >
                <Github className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">GitHub</span>
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => onOpenSettings("about")}
                className="gap-3 px-3 py-2.5 rounded-lg cursor-pointer"
              >
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{t.settings.about}</span>
              </DropdownMenuItem>

              {isLoggedIn && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.preventDefault();
                      setLogoutOpen(true);
                    }}
                    className="gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="text-sm">{t.account.logout}</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

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
              onClick={() => logout()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.account.logout}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
