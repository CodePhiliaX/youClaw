import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Message as AIMessage,
} from "@/components/ai-elements/message";
import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
} from "@/components/ai-elements/attachments";
import { localAssetUrl } from "@/api/transport";
import { useAppStore } from "@/stores/app";
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
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5">
            <p className="text-sm whitespace-pre-wrap leading-relaxed">
              {message.content}
            </p>
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
