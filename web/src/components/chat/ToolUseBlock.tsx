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

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '...' : s
}

function shortPath(p: string) {
  const parts = p.split('/')
  return parts.length <= 3 ? p : '.../' + parts.slice(-2).join('/')
}

function hostname(url: string) {
  try { return new URL(url).hostname } catch { return undefined }
}

type Summary = { text: string; link?: { url: string; label: string } }

function getSummary(name: string, input?: string, isZh = false): Summary {
  const p = tryParseJson(input)

  switch (name) {
    case 'WebFetch': {
      const url = p?.url as string | undefined
      const prompt = p?.prompt as string | undefined
      const host = url ? hostname(url) : undefined
      const link = url && host ? { url, label: host } : undefined
      if (prompt) return { text: truncate(prompt, 60), link }
      return { text: host ? (isZh ? `访问 ${host}` : `Fetch ${host}`) : (isZh ? '访问网页' : 'Fetch web page'), link: undefined }
    }
    case 'WebSearch': {
      const q = p?.query as string | undefined
      return { text: q ? truncate(q, 60) : (isZh ? '搜索网页' : 'Web search') }
    }
    case 'Read': {
      const path = p?.file_path as string | undefined
      return { text: path ? shortPath(path) : (isZh ? '读取文件' : 'Read file') }
    }
    case 'Write': {
      const path = p?.file_path as string | undefined
      return { text: path ? shortPath(path) : (isZh ? '写入文件' : 'Write file') }
    }
    case 'Edit': {
      const path = p?.file_path as string | undefined
      return { text: path ? shortPath(path) : (isZh ? '编辑文件' : 'Edit file') }
    }
    case 'Bash': {
      const desc = p?.description as string | undefined
      if (desc) return { text: truncate(desc, 60) }
      const cmd = p?.command as string | undefined
      return { text: cmd ? truncate(cmd, 60) : (isZh ? '执行命令' : 'Run command') }
    }
    case 'Glob': {
      const pattern = p?.pattern as string | undefined
      return { text: pattern ? truncate(pattern, 50) : (isZh ? '查找文件' : 'Find files') }
    }
    case 'Grep': {
      const pattern = p?.pattern as string | undefined
      return { text: pattern ? truncate(pattern, 50) : (isZh ? '搜索内容' : 'Search contents') }
    }
    case 'Skill': {
      const args = p?.args as string | undefined
      const skill = p?.skill as string | undefined
      if (args) return { text: truncate(args, 60) }
      return { text: skill ?? (isZh ? '调用技能' : 'Run skill') }
    }
    default: {
      // MCP tools: mcp__<server>__<action>
      if (name.startsWith('mcp__')) {
        const semantic = p?.query ?? p?.prompt ?? p?.description ?? p?.args ?? p?.input
        if (typeof semantic === 'string') return { text: truncate(semantic, 60) }
        const parts = name.split('__')
        const action = parts[parts.length - 1].replace(/_/g, ' ')
        return { text: action }
      }
      return { text: input ? `${name}: ${truncate(input, 40)}` : name }
    }
  }
}

export function ToolUseBlock({ items }: { items: ToolUseItem[] }) {
  const { locale } = useI18n()
  const isZh = locale === 'zh'

  if (items.length === 0) return null

  return (
    <div className="space-y-0.5 my-1">
      {items.map(item => {
        const meta = TOOL_META[item.name]
          ?? (item.name.startsWith('mcp__') ? getMcpMeta(item.name.split('__').pop() ?? '') : DEFAULT_META)
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
            <span className="truncate min-w-0">{summary.text}</span>
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
