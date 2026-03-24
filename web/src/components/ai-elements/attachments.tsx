import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
// Local type definitions, replacing ai package dependency
type FileUIPart = { type: "file"; filename: string; url: string; mediaType: string; filePath?: string; file?: File };
type SourceDocumentUIPart = { type: "source-document"; sourceId: string; title: string; url?: string; filename?: string };
import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideoCamera,
  GlobeIcon,
  ImageIcon,
  XIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

// ============================================================================
// Types
// ============================================================================

export type AttachmentData =
  | (FileUIPart & { id: string })
  | (SourceDocumentUIPart & { id: string });

export type AttachmentMediaCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "source"
  | "unknown";

export type AttachmentVariant = "grid" | "inline" | "list";

type AttachmentTypeConfig = {
  badge?: string;
  extensions?: string[];
  icon: typeof ImageIcon;
  iconClassName: string;
  imageSrc?: string;
  label: string;
  mediaTypePrefixes?: string[];
  mediaTypes?: string[];
};

const sourceAttachmentTypeConfig: AttachmentTypeConfig = {
  icon: GlobeIcon,
  iconClassName: "text-sky-600",
  label: "Source",
};

const defaultAttachmentTypeConfig: AttachmentTypeConfig = {
  icon: File,
  iconClassName: "text-muted-foreground",
  label: "Attachment",
};

const attachmentTypeConfigs: AttachmentTypeConfig[] = [
  {
    badge: "PDF",
    icon: FileType,
    iconClassName: "text-rose-600",
    imageSrc: "/images/pdf.png",
    label: "PDF",
    extensions: ["pdf"],
    mediaTypes: ["application/pdf"],
  },
  {
    badge: "DOC",
    icon: FileText,
    iconClassName: "text-slate-600",
    imageSrc: "/images/doc.png",
    label: "Word",
    extensions: ["doc", "docx"],
    mediaTypes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  {
    badge: "XLS",
    icon: FileSpreadsheet,
    iconClassName: "text-emerald-600",
    imageSrc: "/images/xls.png",
    label: "Excel",
    extensions: ["csv", "xls", "xlsx"],
    mediaTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
    ],
  },
  {
    badge: "MD",
    icon: FileCode,
    iconClassName: "text-amber-600",
    imageSrc: "/images/txt.png",
    label: "Markdown",
    extensions: ["md", "mdx"],
    mediaTypes: ["text/markdown"],
  },
  {
    badge: "HTML",
    icon: FileCode,
    iconClassName: "text-amber-600",
    imageSrc: "/images/html.png",
    label: "HTML",
    extensions: ["htm", "html"],
    mediaTypes: ["text/html"],
  },
  {
    badge: "XML",
    icon: FileCode,
    iconClassName: "text-amber-600",
    imageSrc: "/images/xml.png",
    label: "XML",
    extensions: ["xml"],
    mediaTypes: ["application/xml", "text/xml"],
  },
  {
    badge: "TXT",
    icon: FileText,
    iconClassName: "text-slate-600",
    imageSrc: "/images/txt.png",
    label: "Text",
    extensions: ["log", "text", "txt"],
    mediaTypes: ["text/plain"],
  },
  {
    icon: FileImage,
    iconClassName: "text-muted-foreground",
    label: "Image",
    mediaTypePrefixes: ["image/"],
  },
  {
    icon: FileVideoCamera,
    iconClassName: "text-violet-600",
    label: "Video",
    mediaTypePrefixes: ["video/"],
  },
  {
    icon: FileMusic,
    iconClassName: "text-fuchsia-600",
    label: "Audio",
    mediaTypePrefixes: ["audio/"],
  },
  {
    badge: "ZIP",
    icon: FileArchive,
    iconClassName: "text-muted-foreground",
    label: "Archive",
    extensions: ["7z", "gz", "rar", "tar", "zip"],
    mediaTypePrefixes: ["application/zip"],
    mediaTypes: ["application/x-zip-compressed"],
  },
];

// ============================================================================
// Utility Functions
// ============================================================================

const getMediaCategory = (
  data: AttachmentData,
): AttachmentMediaCategory => {
  if (data.type === "source-document") {
    return "source";
  }

  const mediaType = data.mediaType ?? "";

  if (mediaType.startsWith("image/")) {
    return "image";
  }
  if (mediaType.startsWith("video/")) {
    return "video";
  }
  if (mediaType.startsWith("audio/")) {
    return "audio";
  }
  if (mediaType.startsWith("application/") || mediaType.startsWith("text/")) {
    return "document";
  }

  return "unknown";
};

const getAttachmentLabel = (data: AttachmentData): string => {
  if (data.type === "source-document") {
    return data.title || data.filename || "Source";
  }

  const category = getMediaCategory(data);
  return data.filename || (category === "image" ? "Image" : "Attachment");
};

const getAttachmentPath = (data: AttachmentData): string | undefined => {
  if ("filePath" in data && data.filePath) {
    return data.filePath;
  }

  if ("url" in data && data.url && !data.url.startsWith("data:")) {
    return data.url;
  }

  return undefined;
};

const getAttachmentExtension = (data: AttachmentData): string | undefined => {
  if (data.type === "source-document") {
    return undefined
  }

  const candidates = [
    data.filename,
    data.filePath,
    data.url && !data.url.startsWith("data:") ? data.url : undefined,
  ]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const normalized = candidate.split("?")[0]?.split("#")[0] ?? ""
    const lastSegment = normalized.split("/").pop() ?? normalized
    const extension = lastSegment.split(".").pop()?.toLowerCase()

    if (extension && extension !== lastSegment.toLowerCase()) {
      return extension
    }
  }

  return undefined
}

const matchesAttachmentTypeConfig = (
  config: AttachmentTypeConfig,
  mediaType: string,
  extension?: string,
) =>
  Boolean(
    config.mediaTypes?.includes(mediaType) ||
      config.mediaTypePrefixes?.some((prefix) => mediaType.startsWith(prefix)) ||
      (extension ? config.extensions?.includes(extension) : false),
  )

const getAttachmentTypeConfig = (
  data: AttachmentData,
): AttachmentTypeConfig => {
  if (data.type === "source-document") {
    return sourceAttachmentTypeConfig
  }

  const mediaType = data.mediaType ?? ""
  const extension = getAttachmentExtension(data)
  return (
    attachmentTypeConfigs.find((config) =>
      matchesAttachmentTypeConfig(config, mediaType, extension),
    ) ?? defaultAttachmentTypeConfig
  )
}

const getAttachmentTypeLabel = (data: AttachmentData): string =>
  getAttachmentTypeConfig(data).label

const getAttachmentTypeIcon = (data: AttachmentData) =>
  getAttachmentTypeConfig(data).icon

const getAttachmentTypeIconClassName = (data: AttachmentData): string =>
  getAttachmentTypeConfig(data).iconClassName

const getAttachmentTypeImage = (data: AttachmentData): string | undefined =>
  getAttachmentTypeConfig(data).imageSrc

const getAttachmentTypeBadge = (data: AttachmentData): string | undefined =>
  getAttachmentTypeConfig(data).badge

const renderAttachmentImage = (
  url: string,
  filename: string | undefined,
  isGrid: boolean,
) =>
  isGrid ? (
    <img
      alt={filename || "Image"}
      className="size-full object-cover"
      height={96}
      src={url}
      width={96}
    />
  ) : (
    <img
      alt={filename || "Image"}
      className="size-full rounded object-cover"
      height={20}
      src={url}
      width={20}
    />
  );

// ============================================================================
// Contexts
// ============================================================================

interface AttachmentsContextValue {
  variant: AttachmentVariant;
}

const AttachmentsContext = createContext<AttachmentsContextValue | null>(null);

interface AttachmentContextValue {
  data: AttachmentData;
  mediaCategory: AttachmentMediaCategory;
  onRemove?: () => void;
  variant: AttachmentVariant;
}

const AttachmentContext = createContext<AttachmentContextValue | null>(null);

// ============================================================================
// Hooks
// ============================================================================

const useAttachmentsContext = () =>
  useContext(AttachmentsContext) ?? { variant: "grid" as const };

const useAttachmentContext = () => {
  const ctx = useContext(AttachmentContext);
  if (!ctx) {
    throw new Error("Attachment components must be used within <Attachment>");
  }
  return ctx;
};

// ============================================================================
// Attachments - Container
// ============================================================================

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AttachmentVariant;
};

export const Attachments = ({
  variant = "grid",
  className,
  children,
  ...props
}: AttachmentsProps) => {
  const contextValue = useMemo(() => ({ variant }), [variant]);

  return (
    <AttachmentsContext.Provider value={contextValue}>
      <div
        className={cn(
          "flex items-start",
          variant === "list" ? "flex-col gap-2" : "flex-wrap gap-2",
          variant === "grid" && "ml-auto w-fit",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </AttachmentsContext.Provider>
  );
};

// ============================================================================
// Attachment - Item
// ============================================================================

export type AttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentData;
  onRemove?: () => void;
};

export const Attachment = ({
  data,
  onRemove,
  className,
  children,
  ...props
}: AttachmentProps) => {
  const { variant } = useAttachmentsContext();
  const mediaCategory = getMediaCategory(data);

  const contextValue = useMemo<AttachmentContextValue>(
    () => ({ data, mediaCategory, onRemove, variant }),
    [data, mediaCategory, onRemove, variant],
  )

  const attachmentPath = getAttachmentPath(data)
  const shouldShowPathHover =
    variant === "grid" &&
    mediaCategory !== "image" &&
    Boolean(attachmentPath)

  const content = (
    <div
      className={cn(
        "group relative",
        variant === "grid" &&
          mediaCategory === "image" &&
          "size-24 overflow-hidden rounded-lg",
        variant === "grid" &&
          mediaCategory !== "image" && [
            "flex w-52 items-center gap-2.5 rounded-2xl border border-border/70",
            "bg-gradient-to-br from-background to-muted/30 px-2.5 py-2",
            "shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-all",
            "hover:border-border hover:shadow-[0_14px_30px_rgba(15,23,42,0.12)]",
          ],
        variant === "inline" && [
          "flex h-8 cursor-pointer select-none items-center gap-1.5",
          "rounded-md border border-border px-1.5",
          "font-medium text-sm transition-all",
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        ],
        variant === "list" && [
          "flex w-full items-center gap-3 rounded-lg border p-3",
          "hover:bg-accent/50",
        ],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )

  return (
    <AttachmentContext.Provider value={contextValue}>
      {shouldShowPathHover ? (
        <HoverCard openDelay={150}>
          <HoverCardTrigger asChild>{content}</HoverCardTrigger>
          <HoverCardContent
            align="start"
            className="w-80 space-y-1.5 rounded-xl p-3 text-xs"
            side="top"
          >
            <p className="font-medium text-foreground">{getAttachmentLabel(data)}</p>
            <p className="break-all text-muted-foreground">{attachmentPath}</p>
          </HoverCardContent>
        </HoverCard>
      ) : (
        content
      )}
    </AttachmentContext.Provider>
  )
};

// ============================================================================
// AttachmentPreview - Media preview
// ============================================================================

export type AttachmentPreviewProps = HTMLAttributes<HTMLDivElement> & {
  fallbackIcon?: ReactNode;
};

export const AttachmentPreview = ({
  fallbackIcon,
  className,
  ...props
}: AttachmentPreviewProps) => {
  const { data, mediaCategory, variant } = useAttachmentContext();
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const label = getAttachmentLabel(data)
  const attachmentPath = getAttachmentPath(data)
  const typeIconClassName = getAttachmentTypeIconClassName(data)
  const typeImage = getAttachmentTypeImage(data)
  const typeBadge = getAttachmentTypeBadge(data)

  const iconSize = variant === "inline" ? "size-3" : "size-4";

  const renderIcon = (Icon: typeof ImageIcon) => (
    <Icon
      className={cn(
        iconSize,
        variant === "grid" && mediaCategory !== "image"
          ? cn("size-5", typeIconClassName)
          : "text-muted-foreground",
      )}
    />
  )

  const renderContent = () => {
    if (mediaCategory === "image" && data.type === "file" && data.url) {
      return renderAttachmentImage(data.url, data.filename, variant === "grid")
    }

    if (variant === "grid" && mediaCategory !== "image") {
      const Icon = getAttachmentTypeIcon(data)

      return (
        <div className="relative flex size-5 items-center justify-center">
          {typeImage ? (
            <img
              alt={typeBadge ? `${typeBadge} file` : `${label} file`}
              className="size-5 object-contain"
              loading="lazy"
              src={typeImage}
            />
          ) : (
            <Icon className={cn("size-5", typeIconClassName)} />
          )}
          {!typeImage && typeBadge && (
            <span
              className={cn(
                "absolute -right-1 -top-1 rounded-sm bg-muted/88 px-[3px] py-px",
                "font-medium text-[6px] leading-none tracking-[0.04em] text-muted-foreground/90",
                "ring-1 ring-border/40 shadow-[0_1px_1px_rgba(15,23,42,0.04)]",
              )}
            >
              {typeBadge}
            </span>
          )}
        </div>
      )
    }

    if (mediaCategory === "video" && data.type === "file" && data.url) {
      return <video className="size-full object-cover" muted src={data.url} />
    }

    const Icon = getAttachmentTypeIcon(data)
    return fallbackIcon ?? renderIcon(Icon)
  }

  const isImagePreviewable =
    mediaCategory === "image" && data.type === "file" && Boolean(data.url)

  if (isImagePreviewable && data.type === "file") {
    return (
      <>
        <button
          aria-label={`Preview ${label}`}
          className={cn(
            "relative flex shrink-0 items-center justify-center overflow-hidden",
            variant === "grid" && "size-full cursor-zoom-in bg-muted",
            variant === "inline" && "size-5 rounded bg-background",
            variant === "list" && "size-12 rounded bg-muted",
            className,
          )}
          onClick={() => setIsPreviewOpen(true)}
          type="button"
          {...props}
        >
          {renderContent()}
          {variant === "grid" && (
            <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
          )}
        </button>
        <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
          <DialogContent className="w-auto max-w-[92vw] border-0 bg-transparent p-0 shadow-none">
            <DialogTitle className="sr-only">{label}</DialogTitle>
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl">
              <img
                alt={data.filename || "Image"}
                className="max-h-[80vh] w-auto max-w-[92vw] object-contain"
                src={data.url}
              />
              <div className="border-t border-border/60 px-4 py-3">
                <p className="truncate font-medium text-sm">{label}</p>
                {attachmentPath && (
                  <p className="mt-1 break-all text-muted-foreground text-xs">
                    {attachmentPath}
                  </p>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden",
        variant === "grid" && "size-full bg-muted",
        variant === "grid" &&
          mediaCategory !== "image" &&
          "size-6",
        variant === "inline" && "size-5 rounded bg-background",
        variant === "list" && "size-12 rounded bg-muted",
        className,
      )}
      {...props}
    >
      {renderContent()}
    </div>
  )
};

// ============================================================================
// AttachmentInfo - Name and type display
// ============================================================================

export type AttachmentInfoProps = HTMLAttributes<HTMLDivElement> & {
  showMediaType?: boolean;
};

export const AttachmentInfo = ({
  showMediaType = false,
  className,
  ...props
}: AttachmentInfoProps) => {
  const { data, mediaCategory, onRemove, variant } = useAttachmentContext()
  const label = getAttachmentLabel(data)
  const typeLabel = getAttachmentTypeLabel(data)

  if (variant === "grid" && mediaCategory === "image") {
    return (
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-[1]",
          "bg-gradient-to-t from-black/70 via-black/35 to-transparent px-2 py-2",
          className,
        )}
        {...props}
      >
        <span className="block truncate text-white text-xs">{label}</span>
      </div>
    )
  }

  if (variant === "grid") {
    return (
      <div
        className={cn(
          "min-w-0 flex-1",
          onRemove ? "pr-6" : "pr-1",
          className,
        )}
        {...props}
      >
        <span className="block truncate font-semibold text-[13px] leading-[18px] text-foreground/95">
          {label}
        </span>
      </div>
    )
  }

  return (
    <div className={cn("min-w-0 flex-1", className)} {...props}>
      <span className="block truncate">{label}</span>
      {showMediaType && 'mediaType' in data && data.mediaType && (
        <span className="block truncate text-muted-foreground text-xs">
          {typeLabel}
        </span>
      )}
    </div>
  )
};

// ============================================================================
// AttachmentRemove - Remove button
// ============================================================================

export type AttachmentRemoveProps = ComponentProps<typeof Button> & {
  label?: string;
};

export const AttachmentRemove = ({
  label = "Remove",
  className,
  children,
  ...props
}: AttachmentRemoveProps) => {
  const { onRemove, variant } = useAttachmentContext();

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove?.();
    },
    [onRemove],
  );

  if (!onRemove) {
    return null;
  }

  return (
    <Button
      aria-label={label}
      className={cn(
        variant === "grid" && [
          "absolute top-2 right-2 z-10 size-6 rounded-full p-0",
          "bg-background/80 backdrop-blur-sm",
          "opacity-0 transition-opacity group-hover:opacity-100",
          "hover:bg-background",
          "[&>svg]:size-3",
        ],
        variant === "inline" && [
          "size-5 rounded p-0",
          "opacity-0 transition-opacity group-hover:opacity-100",
          "[&>svg]:size-2.5",
        ],
        variant === "list" && ["size-8 shrink-0 rounded p-0", "[&>svg]:size-4"],
        className,
      )}
      onClick={handleClick}
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <XIcon />}
      <span className="sr-only">{label}</span>
    </Button>
  );
};

// ============================================================================
// AttachmentHoverCard - Hover preview
// ============================================================================

export type AttachmentHoverCardProps = ComponentProps<typeof HoverCard>;

export const AttachmentHoverCard = ({
  openDelay = 0,
  closeDelay = 0,
  ...props
}: AttachmentHoverCardProps) => (
  <HoverCard closeDelay={closeDelay} openDelay={openDelay} {...props} />
);

export type AttachmentHoverCardTriggerProps = ComponentProps<
  typeof HoverCardTrigger
>;

export const AttachmentHoverCardTrigger = (
  props: AttachmentHoverCardTriggerProps,
) => <HoverCardTrigger {...props} />;

export type AttachmentHoverCardContentProps = ComponentProps<
  typeof HoverCardContent
>;

export const AttachmentHoverCardContent = ({
  align = "start",
  className,
  ...props
}: AttachmentHoverCardContentProps) => (
  <HoverCardContent
    align={align}
    className={cn("w-auto p-2", className)}
    {...props}
  />
);

// ============================================================================
// AttachmentEmpty - Empty state
// ============================================================================

export type AttachmentEmptyProps = HTMLAttributes<HTMLDivElement>;

export const AttachmentEmpty = ({
  className,
  children,
  ...props
}: AttachmentEmptyProps) => (
  <div
    className={cn(
      "flex items-center justify-center p-4 text-muted-foreground text-sm",
      className,
    )}
    {...props}
  >
    {children ?? "No attachments"}
  </div>
);
