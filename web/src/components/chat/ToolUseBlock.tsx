import {
  Loader2,
  Globe,
  FileText,
  Pencil,
  Terminal,
  Search,
  Wrench,
  ExternalLink,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { ToolUseItem } from '@/hooks/useChat'
import { useI18n } from '@/i18n'

type ToolMeta = { icon: LucideIcon; color: string }
type Summary = { text: string; title?: string; link?: { url: string; label: string } }

const TOOL_META: Record<string, ToolMeta> = {
  WebFetch:  { icon: Globe, color: 'text-emerald-500' },
  WebSearch: { icon: Search, color: 'text-emerald-500' },
  Read:      { icon: FileText, color: 'text-blue-500' },
  Glob:      { icon: Search, color: 'text-violet-500' },
  Grep:      { icon: Search, color: 'text-violet-500' },
  Write:     { icon: Pencil, color: 'text-amber-500' },
  Edit:      { icon: Pencil, color: 'text-amber-500' },
  Bash:      { icon: Terminal, color: 'text-orange-500' },
  Skill:     { icon: Zap, color: 'text-pink-500' },
}

const DEFAULT_META: ToolMeta = { icon: Wrench, color: 'text-muted-foreground' }

const TOOL_NAME_ALIASES: Record<string, string> = {
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  read: 'Read',
  glob: 'Glob',
  grep: 'Grep',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
  skill: 'Skill',
}

/** Resolve meta for MCP tools (mcp__<server>__<action>) by action keyword */
function getMcpMeta(action: string): ToolMeta {
  if (/search|query|find/i.test(action)) return { icon: Search, color: 'text-emerald-500' }
  if (/fetch|browse|scrape|crawl|read/i.test(action)) return { icon: Globe, color: 'text-emerald-500' }
  if (/write|create|edit|update|delete/i.test(action)) return { icon: Pencil, color: 'text-amber-500' }
  if (/run|exec|shell|bash/i.test(action)) return { icon: Terminal, color: 'text-orange-500' }
  return { icon: Zap, color: 'text-cyan-500' }
}

function tryParseJson(s?: string): Record<string, unknown> | null {
  if (!s) return null
  try {
    const p = JSON.parse(s)
    return typeof p === 'object' && p !== null && !Array.isArray(p) ? p : null
  } catch {
    // Truncated JSON fallback: extract key-value pairs via regex
    return extractFromTruncated(s)
  }
}

/** Extract string values from truncated JSON like {"key":"value","key2":"val... */
function extractFromTruncated(s: string): Record<string, unknown> | null {
  const result: Record<string, string> = {}
  const re = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    result[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return Object.keys(result).length > 0 ? result : null
}

function normalizeToolName(name: string) {
  if (name.startsWith('mcp__')) return name
  return TOOL_NAME_ALIASES[name.trim().toLowerCase()] ?? name
}

function summarizeText(text: string, fallback: string): Summary {
  const trimmed = text.trim()
  return { text: trimmed || fallback, title: trimmed || fallback }
}

function hostname(url: string) {
  try { return new URL(url).hostname } catch { return undefined }
}

function getSummary(name: string, input?: string, isZh = false): Summary {
  const normalizedName = normalizeToolName(name)
  const p = tryParseJson(input)

  switch (normalizedName) {
    case 'WebFetch': {
      const url = p?.url as string | undefined
      const prompt = p?.prompt as string | undefined
      const host = url ? hostname(url) : undefined
      const link = url && host ? { url, label: host } : undefined
      if (prompt) return { ...summarizeText(prompt, isZh ? '访问网页' : 'Fetch web page'), link }
      return { text: host ? (isZh ? `访问 ${host}` : `Fetch ${host}`) : (isZh ? '访问网页' : 'Fetch web page'), title: url, link: undefined }
    }
    case 'WebSearch': {
      const q = p?.query as string | undefined
      return q ? summarizeText(q, isZh ? '搜索网页' : 'Web search') : { text: isZh ? '搜索网页' : 'Web search' }
    }
    case 'Read': {
      const path = p?.file_path as string | undefined
      return path ? summarizeText(path, isZh ? '读取文件' : 'Read file') : { text: isZh ? '读取文件' : 'Read file' }
    }
    case 'Write': {
      const path = p?.file_path as string | undefined
      return path ? summarizeText(path, isZh ? '写入文件' : 'Write file') : { text: isZh ? '写入文件' : 'Write file' }
    }
    case 'Edit': {
      const path = p?.file_path as string | undefined
      return path ? summarizeText(path, isZh ? '编辑文件' : 'Edit file') : { text: isZh ? '编辑文件' : 'Edit file' }
    }
    case 'Bash': {
      const desc = p?.description as string | undefined
      if (desc) return summarizeText(desc, isZh ? '执行命令' : 'Run command')
      const cmd = p?.command as string | undefined
      return cmd ? summarizeText(cmd, isZh ? '执行命令' : 'Run command') : { text: isZh ? '执行命令' : 'Run command' }
    }
    case 'Glob': {
      const pattern = p?.pattern as string | undefined
      return pattern ? summarizeText(pattern, isZh ? '查找文件' : 'Find files') : { text: isZh ? '查找文件' : 'Find files' }
    }
    case 'Grep': {
      const pattern = p?.pattern as string | undefined
      return pattern ? summarizeText(pattern, isZh ? '搜索内容' : 'Search contents') : { text: isZh ? '搜索内容' : 'Search contents' }
    }
    case 'Skill': {
      const args = p?.args as string | undefined
      const skill = p?.skill as string | undefined
      if (args) return summarizeText(args, isZh ? '调用技能' : 'Run skill')
      return skill ? summarizeText(skill, isZh ? '调用技能' : 'Run skill') : { text: isZh ? '调用技能' : 'Run skill' }
    }
    default: {
      // MCP tools: mcp__<server>__<action>
      if (normalizedName.startsWith('mcp__')) {
        const semantic = p?.query ?? p?.prompt ?? p?.description ?? p?.args ?? p?.input
        if (typeof semantic === 'string') return summarizeText(semantic, normalizedName)
        const parts = normalizedName.split('__')
        const action = parts[parts.length - 1].replace(/_/g, ' ')
        return { text: action }
      }
      if (input) return summarizeText(`${normalizedName}: ${input}`, normalizedName)
      return { text: normalizedName }
    }
  }
}

export function ToolUseBlock({ items }: { items: ToolUseItem[] }) {
  const { locale } = useI18n()
  const isZh = locale === 'zh'

  if (items.length === 0) return null

  return (
    <div className="space-y-0.5 my-1 border-l-2 border-muted-foreground/25 pl-2.5">
      {items.map(item => {
        const normalizedName = normalizeToolName(item.name)
        const meta = TOOL_META[normalizedName]
          ?? (normalizedName.startsWith('mcp__') ? getMcpMeta(normalizedName.split('__').pop() ?? '') : DEFAULT_META)
        const Icon = meta.icon
        const isRunning = item.status === 'running'

        const summary = getSummary(item.name, item.input, isZh)

        return (
          <div key={item.id} className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground w-full min-w-0 overflow-hidden whitespace-nowrap">
            {isRunning ? (
              <Loader2 className={`h-3.5 w-3.5 animate-spin shrink-0 ${meta.color}`} />
            ) : (
              <Icon className={`h-3.5 w-3.5 shrink-0 ${meta.color}`} />
            )}
            <span className="min-w-0 flex-1 truncate" title={summary.title ?? summary.text}>
              {summary.text}
            </span>
            {summary.link && (
              <a
                href={summary.link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 shrink-0 text-primary/70 hover:text-primary hover:underline transition-colors"
              >
                {summary.link.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}
