import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import {
  Bot,
  CalendarClock,
  Brain,
  Settings,
  PanelLeftClose,
  PanelLeft,
  SquarePen,
  LogIn,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useSidebar } from "@/hooks/useSidebar";
import { isTauri } from "@/api/transport";
import { useAppStore } from "@/stores/app";

/** 行内左右 padding，保证收起时图标在 52px 内居中 (8+36+8=52) */
const ROW_PX = "px-2";

interface AppSidebarProps {
  onOpenSettings: () => void;
}

export function AppSidebar({ onOpenSettings }: AppSidebarProps) {
  const { isCollapsed, toggle } = useSidebar();
  const { t, locale, setLocale } = useI18n();
  const { user, isLoggedIn, authLoading, creditBalance, login } = useAppStore();
  const [platform, setPlatform] = useState("");

  useEffect(() => {
    if (!isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<string>("get_platform").then(setPlatform);
    });
  }, []);

  const isMac = platform === "macos";

  const navItems = [
    { to: "/", icon: SquarePen, label: t.nav.chat },
    { to: "/agents", icon: Bot, label: t.nav.agents },
    { to: "/cron", icon: CalendarClock, label: t.nav.tasks },
    { to: "/memory", icon: Brain, label: t.nav.memory },
  ];

  return (
      <aside
        className={cn(
          "shrink-0 flex flex-col overflow-hidden",
          "bg-muted/30 border-r",
          "border-[var(--subtle-border)]",
          "transition-[width] duration-200 ease-[var(--ease-soft)]",
          isCollapsed ? "w-[52px]" : "w-[220px]",
        )}
        aria-expanded={!isCollapsed}
      >
        {/* macOS 交通灯空间 */}
        {isMac && (
          <div
            className="h-7 shrink-0"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          />
        )}

        {/* 顶部操作栏 */}
        <div
          className={cn("flex items-center h-[52px] shrink-0", ROW_PX)}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
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

        {/* 页面导航 */}
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

        {/* 填充空间 */}
        <div className="flex-1" />

        {/* 底部 */}
        <div
          className="border-t border-[var(--subtle-border)] py-2 space-y-0.5 px-1.5"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* 用户信息 / 登录按钮 */}
          {isLoggedIn && user ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className={cn(
                "flex items-center h-9 w-full rounded-[10px] whitespace-nowrap overflow-hidden",
                "transition-all duration-200 ease-[var(--ease-soft)]",
                "px-1",
                "text-muted-foreground hover:text-foreground hover:bg-[var(--surface-hover)]",
              )}
            >
              <div className="w-9 h-9 shrink-0 flex items-center justify-center">
                {user.avatar ? (
                  <img src={user.avatar} alt={user.name} className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold">
                    {user.name?.[0]?.toUpperCase() ?? '?'}
                  </div>
                )}
              </div>
              <span
                className={cn(
                  "text-sm truncate transition-opacity duration-200 flex-1 text-left",
                  isCollapsed ? "opacity-0" : "opacity-100",
                )}
              >
                {user.name}
              </span>
              {!isCollapsed && creditBalance !== null && (
                <span className="text-xs text-muted-foreground flex items-center gap-0.5 shrink-0 mr-1">
                  <Coins className="h-3 w-3" />
                  {creditBalance}
                </span>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => login()}
              disabled={authLoading}
              className={cn(
                "flex items-center h-9 w-full rounded-[10px] whitespace-nowrap overflow-hidden",
                "transition-all duration-200 ease-[var(--ease-soft)]",
                "px-1",
                "text-muted-foreground hover:text-foreground hover:bg-[var(--surface-hover)]",
              )}
            >
              <div className="w-9 h-9 shrink-0 flex items-center justify-center">
                <LogIn className="h-4 w-4" />
              </div>
              <span
                className={cn(
                  "text-sm transition-opacity duration-200",
                  isCollapsed ? "opacity-0" : "opacity-100",
                )}
              >
                {authLoading ? t.account.loggingIn : t.account.login}
              </span>
            </button>
          )}

          {/* 设置 */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={onOpenSettings}
              className={cn(
                "flex items-center h-9 w-full rounded-[10px] whitespace-nowrap overflow-hidden",
                "transition-all duration-200 ease-[var(--ease-soft)]",
                "px-1",
                "text-muted-foreground hover:text-foreground hover:bg-[var(--surface-hover)]",
              )}
              aria-label={t.settings.title}
            >
              <div className="w-9 h-9 shrink-0 flex items-center justify-center">
                <Settings className="h-4 w-4" />
              </div>
              <span
                className={cn(
                  "text-sm transition-opacity duration-200",
                  isCollapsed ? "opacity-0" : "opacity-100",
                )}
              >
                {t.settings.title}
              </span>
            </button>
            {!isCollapsed && <div className="flex-1 min-w-0" />}
            {!isCollapsed && (
              <button
                type="button"
                onClick={() => setLocale(locale === "en" ? "zh" : "en")}
                className="shrink-0 px-2 py-0.5 rounded-md border border-[var(--subtle-border)] text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-[var(--surface-hover)] transition-all duration-200 ease-[var(--ease-soft)]"
              >
                {locale === "en" ? "中" : "EN"}
              </button>
            )}
          </div>
        </div>
      </aside>
  );
}
