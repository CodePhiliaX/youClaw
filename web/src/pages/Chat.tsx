import { useState, useRef, useEffect } from "react";
import { Plus, Search, X, MoreHorizontal, Trash2, Palette, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useChatContext } from "@/hooks/chatCtx";
import { groupChatsByDate, resolveAvatar, PRESET_GRADIENTS } from "@/lib/chat-utils";
import { ChatWelcome } from "@/components/chat/ChatWelcome";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { SidePanel } from "@/components/layout/SidePanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

export function Chat() {
  const { t } = useI18n();
  const chatCtx = useChatContext();
  const { chatId, messages } = chatCtx;
  const isNewChat = !chatId && messages.length === 0;
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [avatarPickerChatId, setAvatarPickerChatId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    } else {
      chatCtx.setSearchQuery("");
    }
  }, [searchOpen]);

  // Focus input when edit mode activates
  useEffect(() => {
    if (editingChatId) {
      // Focus after DOM rendering completes
      requestAnimationFrame(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      });
    }
  }, [editingChatId]);

  const filteredChats = chatCtx.searchQuery
    ? chatCtx.chatList.filter((c) =>
        c.name.toLowerCase().includes(chatCtx.searchQuery.toLowerCase()),
      )
    : chatCtx.chatList;

  const chatGroups = groupChatsByDate(filteredChats, {
    today: t.chat.today,
    yesterday: t.chat.yesterday,
    older: t.chat.older,
  });

  const handleDeleteConfirm = async () => {
    if (deleteTarget) {
      await chatCtx.deleteChat(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const handleStartEditName = (cid: string, currentName: string) => {
    setEditingName(currentName);
    // Wait for DropdownMenu close animation before activating edit
    setTimeout(() => setEditingChatId(cid), 100);
  };

  const handleSaveEditName = async () => {
    if (editingChatId && editingName.trim()) {
      await chatCtx.updateChat(editingChatId, { name: editingName.trim() });
    }
    setEditingChatId(null);
  };

  const handleCancelEditName = () => {
    setEditingChatId(null);
  };

  return (
    <div className="flex h-full">
      {/* Left side: Chat list */}
      <SidePanel>
        <div className="p-3 border-b border-[var(--subtle-border)] flex items-center justify-between">
          <h2 className="font-semibold text-sm">{t.nav.chat}</h2>
          <div className="flex items-center gap-0.5">
            <button
              data-testid="chat-search-toggle"
              onClick={() => setSearchOpen((v) => !v)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-all duration-200 ease-[var(--ease-soft)]",
                searchOpen
                  ? "text-foreground bg-[var(--surface-hover)]"
                  : "text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground",
              )}
              title={t.sidebar.search}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            <button
              data-testid="chat-new"
              onClick={() => chatCtx.newChat()}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground transition-all duration-200 ease-[var(--ease-soft)]"
              title={t.sidebar.newChat}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Search (expand/collapse) */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-200 ease-[var(--ease-soft)]",
            searchOpen ? "max-h-12 opacity-100" : "max-h-0 opacity-0",
          )}
        >
          <div className="px-3 py-2">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                data-testid="chat-search"
                className="w-full bg-[var(--surface-raised)] border border-[var(--subtle-border)] rounded-xl px-3 py-1.5 pr-7 text-sm transition-all duration-200 ease-[var(--ease-soft)] focus:outline-none focus:border-primary/40 focus:shadow-[0_0_0_3px_oklch(0.55_0.2_25/0.1)]"
                placeholder={t.sidebar.search}
                value={chatCtx.searchQuery}
                onChange={(e) => chatCtx.setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchOpen(false);
                }}
              />
              {chatCtx.searchQuery && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => chatCtx.setSearchQuery("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5" role="listbox">
          {chatGroups.length === 0 && (
            <p className="text-xs text-muted-foreground px-2.5 py-4 text-center">
              {t.chat.noConversations}
            </p>
          )}
          {chatGroups.map((group) => (
            <div key={group.label}>
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2.5 pt-3 pb-1">
                {group.label}
              </div>
              {group.items.map((chat) => (
                <div
                  key={chat.chat_id}
                  role="option"
                  data-testid="chat-item"
                  aria-selected={chatCtx.chatId === chat.chat_id}
                  className={cn(
                    "group flex items-start rounded-[10px] px-2.5 py-2.5 cursor-pointer gap-2.5",
                    "transition-all duration-200 ease-[var(--ease-soft)]",
                    chatCtx.chatId === chat.chat_id
                      ? "bg-primary/8 text-foreground"
                      : "text-muted-foreground hover:bg-[var(--surface-hover)]",
                  )}
                  onClick={() => chatCtx.loadChat(chat.chat_id)}
                >
                  {/* Avatar: Popover anchor */}
                  <Popover
                    open={avatarPickerChatId === chat.chat_id}
                    onOpenChange={(open) => !open && setAvatarPickerChatId(null)}
                  >
                    <PopoverTrigger asChild>
                      <div
                        className="w-9 h-9 rounded-full shrink-0 mt-0.5"
                        style={{ background: resolveAvatar(chat.avatar) }}
                      />
                    </PopoverTrigger>
                    <PopoverContent side="right" align="start" className="w-auto p-3">
                      <div className="grid grid-cols-4 gap-2">
                        {PRESET_GRADIENTS.map((gradient, i) => (
                          <button
                            key={i}
                            className={cn(
                              "w-9 h-9 rounded-full transition-all",
                              chat.avatar === `gradient:${i}` ? "ring-2 ring-white ring-offset-2 ring-offset-background" : "hover:scale-110",
                            )}
                            style={{ background: gradient }}
                            onClick={(e) => {
                              e.stopPropagation();
                              chatCtx.updateChat(chat.chat_id, { avatar: `gradient:${i}` });
                              setAvatarPickerChatId(null);
                            }}
                          />
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      {editingChatId === chat.chat_id ? (
                        <input
                          ref={editInputRef}
                          className="text-[13px] font-medium flex-1 text-foreground bg-transparent border border-primary/40 rounded px-1 py-0 outline-none min-w-0"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEditName();
                            if (e.key === "Escape") handleCancelEditName();
                          }}
                          onBlur={handleSaveEditName}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-[13px] font-medium truncate flex-1 text-foreground">
                          {chat.name}
                        </span>
                      )}
                      <div className="relative shrink-0">
                        <span className="text-[10px] text-muted-foreground group-hover:opacity-0 transition-opacity duration-200">
                          {new Date(chat.last_message_time).toLocaleTimeString(
                            [],
                            { hour: "2-digit", minute: "2-digit" },
                          )}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              data-testid="chat-item-menu"
                              className="absolute inset-0 opacity-0 group-hover:opacity-100 rounded-md flex items-center justify-center hover:bg-accent transition-opacity duration-200 hover:cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                setTimeout(() => setAvatarPickerChatId(chat.chat_id), 100);
                              }}
                            >
                              <Palette className="h-3.5 w-3.5 mr-2" />
                              {t.chat.editAvatar}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEditName(chat.chat_id, chat.name);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              {t.chat.editTitle}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              data-testid="chat-item-delete"
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(chat.chat_id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              {t.common.delete}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {chat.last_message || "\u00A0"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </SidePanel>

      {/* Right: Chat content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {isNewChat ? <ChatWelcome /> : <ChatMessages />}

        {/* ChatInput always rendered, animated from center to bottom */}
        <div
          className={
            isNewChat
              ? "absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 transition-all duration-500 ease-[var(--ease-soft)]"
              : "relative px-0 transition-all duration-500 ease-[var(--ease-soft)]"
          }
        >
          <div className="max-w-3xl mx-auto">
            {/* Welcome text, fades out after send */}
            <div
              className={
                isNewChat
                  ? "text-center space-y-4 mb-8 opacity-100 transition-all duration-500 ease-[var(--ease-soft)]"
                  : "text-center space-y-4 mb-0 opacity-0 h-0 overflow-hidden transition-all duration-500 ease-[var(--ease-soft)]"
              }
            >
              <img
                src="/icon.svg"
                alt="YouClaw"
                className="h-24 w-24 mb-3 mx-auto transition-transform duration-300 ease-out hover:scale-110 hover:rotate-3"
              />
              <h1 className="text-2xl font-semibold tracking-tight">
                {t.chat.welcome}
              </h1>
              <p className="text-sm text-muted-foreground/70 max-w-md mx-auto leading-relaxed">
                {t.chat.startHint}
              </p>
            </div>
            <ChatInput />
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.chat.deleteChat}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.chat.confirmDelete}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
