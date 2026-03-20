import { useRef, useEffect, useState } from "react";
import {
  MoreHorizontal,
  Trash2,
  Palette,
  Pencil,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useChatProcessing } from "@/hooks/useChat";
import { resolveAvatar, PRESET_GRADIENTS } from "@/lib/chat-utils";
import type { ChatItem } from "@/lib/chat-utils";
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

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'TG',
  feishu: 'Feishu',
  qq: 'QQ',
  wecom: 'WeCom',
  dingtalk: 'DingTalk',
  'wechat-oa': 'WeChat',
}

interface ChatListItemProps {
  chat: ChatItem;
  isActive: boolean;
  onSelect: () => void;
  onDelete: (chatId: string) => void;
  onUpdateAvatar: (chatId: string, avatar: string) => void;
  onUpdateName: (chatId: string, name: string) => void;
}

export function ChatListItem({
  chat,
  isActive,
  onSelect,
  onDelete,
  onUpdateAvatar,
  onUpdateName,
}: ChatListItemProps) {
  const { t } = useI18n();
  const isProcessing = useChatProcessing(chat.chat_id);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      });
    }
  }, [editing]);

  const handleStartEdit = (currentName: string) => {
    setEditingName(currentName);
    setTimeout(() => setEditing(true), 100);
  };

  const handleSaveEdit = () => {
    if (editingName.trim()) {
      onUpdateName(chat.chat_id, editingName.trim());
    }
    setEditing(false);
  };

  return (
    <div
      role="option"
      data-testid="chat-item"
      aria-selected={isActive}
      className={cn(
        "group flex items-start rounded-[10px] px-2.5 py-2.5 cursor-pointer gap-2.5",
        "transition-all duration-200 ease-[var(--ease-soft)]",
        isActive
          ? "bg-primary/8 text-foreground"
          : "text-muted-foreground hover:bg-[var(--surface-hover)]",
      )}
      onClick={onSelect}
    >
      {/* Avatar */}
      <Popover
        open={avatarPickerOpen}
        onOpenChange={(open) => !open && setAvatarPickerOpen(false)}
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
                  chat.avatar === `gradient:${i}`
                    ? "ring-2 ring-white ring-offset-2 ring-offset-background"
                    : "hover:scale-110",
                )}
                style={{ background: gradient }}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateAvatar(chat.chat_id, `gradient:${i}`);
                  setAvatarPickerOpen(false);
                }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          {editing ? (
            <input
              ref={editInputRef}
              className="text-[13px] font-medium flex-1 text-foreground bg-transparent border border-primary/40 rounded px-1 py-0 outline-none min-w-0"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={handleSaveEdit}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-[13px] font-medium truncate flex-1 text-foreground flex items-center gap-1.5">
              {chat.channel && chat.channel !== 'web' && (
                <span className="shrink-0 text-[9px] font-medium px-1 py-px rounded bg-muted text-muted-foreground">
                  {CHANNEL_LABELS[chat.channel] ?? chat.channel}
                </span>
              )}
              {chat.name}
            </span>
          )}
          <div className="relative shrink-0">
            <span className="text-[10px] text-muted-foreground group-hover:opacity-0 transition-opacity duration-200">
              {new Date(chat.last_message_time).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
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
                    setTimeout(() => setAvatarPickerOpen(true), 100);
                  }}
                >
                  <Palette className="h-3.5 w-3.5 mr-2" />
                  {t.chat.editAvatar}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartEdit(chat.name);
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
                    onDelete(chat.chat_id);
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
          {isProcessing ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t.chat.thinking}
            </span>
          ) : (
            chat.last_message || "\u00A0"
          )}
        </p>
      </div>
    </div>
  );
}
