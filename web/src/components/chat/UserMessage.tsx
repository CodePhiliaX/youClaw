import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Message as AIMessage,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
} from "@/components/ai-elements/attachments";
import { localAssetUrl } from "@/api/transport";
import { useAppStore } from "@/stores/app";
import { formatUserMessageForDisplay } from "@/lib/user-message-format";
import type { Message } from "@/hooks/useChat";

function UserAvatar() {
  const { user, isLoggedIn } = useAppStore();
  const sizeClass = "w-8 h-8 text-xs";

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
      <User className="h-4 w-4" />
    </div>
  );
}

export function UserMessage({ message }: { message: Message }) {
  const attachments = message.attachments ?? [];
  const formattedContent = formatUserMessageForDisplay(message.content);

  return (
    <AIMessage from="user" data-testid="message-user">
      <div className="group flex gap-3 py-3 flex-row-reverse">
        <div className="mt-0.5">
          <UserAvatar />
        </div>
        <div className="flex-1 min-w-0 flex flex-col items-end">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            {/* {t.chat.you} */}
            <span className="ml-2 text-[10px] opacity-60">
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="w-fit max-w-full overflow-hidden rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-primary-foreground">
            <MessageResponse
              className={cn(
                "text-sm leading-relaxed text-primary-foreground [overflow-wrap:anywhere]",
                "[&_p]:my-0 [&_p]:[overflow-wrap:anywhere]",
                "[&_ul]:my-0 [&_ul]:space-y-1 [&_ul]:pl-5 [&_ul]:marker:text-primary-foreground/80",
                "[&_ol]:my-0 [&_ol]:space-y-1 [&_ol]:pl-5 [&_ol]:marker:text-primary-foreground/80",
                "[&_li]:py-0.5 [&_li]:[overflow-wrap:anywhere]",
                "[&_hr]:my-3 [&_hr]:border-primary-foreground/25",
                "[&_a]:text-primary-foreground [&_a]:underline [&_a]:underline-offset-4",
                "[&_code]:rounded-md [&_code]:bg-black/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.95em]",
                "[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-black/10 [&_pre]:p-3",
                "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
                "[&_blockquote]:border-l-2 [&_blockquote]:border-primary-foreground/20 [&_blockquote]:pl-3 [&_blockquote]:text-primary-foreground/90"
              )}
            >
              {formattedContent}
            </MessageResponse>
          </div>
          {attachments.length > 0 && (
            <Attachments variant="grid" className="mt-2 ml-0">
              {attachments.map((a, i) => {
                // Support both old format (data: base64) and new format (filePath)
                const url =
                  "filePath" in a && a.filePath
                    ? localAssetUrl(a.filePath)
                    : "data" in a && (a as { data?: string }).data
                      ? `data:${a.mediaType};base64,${(a as { data: string }).data}`
                      : "";
                return (
                  <Attachment
                    key={i}
                    data={{
                      id: String(i),
                      type: "file" as const,
                      filename: a.filename,
                      mediaType: a.mediaType,
                      url,
                      filePath: "filePath" in a ? a.filePath : undefined,
                    }}
                  >
                    <AttachmentPreview />
                    <AttachmentInfo />
                  </Attachment>
                );
              })}
            </Attachments>
          )}
        </div>
      </div>
    </AIMessage>
  );
}
