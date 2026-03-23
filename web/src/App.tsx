import { useEffect, useState } from 'react'
import { getBackendBaseUrl, getTauriInvoke, isTauri, updateCachedBaseUrl } from './api/transport'

type HealthPayload = {
  ok: boolean
  mode?: string
  runtime?: string
  pid?: number
  platform?: string
  startedAt?: string
  port?: number
}

type SidecarPayload = {
  status: string
  message: string
}

type HealthState =
  | { state: 'checking'; baseUrl: string; lastCheckedAt: string | null; details: null; error: null }
  | { state: 'up'; baseUrl: string; lastCheckedAt: string; details: HealthPayload; error: null }
  | { state: 'down'; baseUrl: string; lastCheckedAt: string; details: null; error: string }

function StatusCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'neutral' | 'good' | 'bad'
}) {
  const toneClass = tone === 'good'
    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
    : tone === 'bad'
      ? 'border-rose-400/30 bg-rose-500/10 text-rose-200'
      : 'border-white/10 bg-white/5 text-white'

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.2em] text-white/55">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  )
}

export default function App() {
  const [health, setHealth] = useState<HealthState>({
    state: 'checking',
    baseUrl: 'http://localhost:62601',
    lastCheckedAt: null,
    details: null,
    error: null,
  })
  const [sidecar, setSidecar] = useState<SidecarPayload | null>(null)

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let cleanup: (() => void) | null = null

    const checkHealth = async () => {
      const baseUrl = await getBackendBaseUrl().catch(() => 'http://localhost:62601')
      const lastCheckedAt = new Date().toISOString()

      try {
        const res = await fetch(`${baseUrl}/api/health`, {
          signal: AbortSignal.timeout(1200),
          cache: 'no-store',
        })

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }

        const payload = await res.json() as HealthPayload

        if (disposed) return
        if (typeof payload.port === 'number') {
          updateCachedBaseUrl(`http://localhost:${payload.port}`)
        }
        setHealth({
          state: 'up',
          baseUrl,
          lastCheckedAt,
          details: payload,
          error: null,
        })
      } catch (err) {
        if (disposed) return
        setHealth({
          state: 'down',
          baseUrl,
          lastCheckedAt,
          details: null,
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        if (!disposed) {
          timer = setTimeout(checkHealth, 2000)
        }
      }
    }

    const loadInitialSidecarState = async () => {
      if (!isTauri) return
      try {
        const payload = await getTauriInvoke()('get_sidecar_status') as SidecarPayload
        if (!disposed) {
          setSidecar(payload)
        }
      } catch {
        // Ignore invoke failures in browser/dev mode.
      }
    }

    void loadInitialSidecarState()
    void checkHealth()

    if (isTauri) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen<SidecarPayload>('sidecar-event', (event) => {
          setSidecar(event.payload)
          const match = event.payload.message.match(/port\s+(\d+)/i)
          if (match) {
            updateCachedBaseUrl(`http://localhost:${match[1]}`)
          }
          if (event.payload.status === 'ready') {
            void checkHealth()
          }
        }).then((fn) => {
          cleanup = fn
        }).catch(() => {})
      }).catch(() => {})
    }

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      cleanup?.()
    }
  }, [])

  const isUp = health.state === 'up'
  const portText = (() => {
    if (health.state === 'up' && typeof health.details.port === 'number') {
      return String(health.details.port)
    }

    try {
      return new URL(health.baseUrl).port || '62601'
    } catch {
      return '62601'
    }
  })()

  const lastCheckedText = health.lastCheckedAt
    ? new Date(health.lastCheckedAt).toLocaleString()
    : 'waiting'

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.22),transparent_32%),linear-gradient(180deg,#0b1020_0%,#111827_100%)] px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-[28px] border border-white/10 bg-black/25 p-8 shadow-2xl shadow-cyan-950/30 backdrop-blur">
          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-[0.35em] text-cyan-200/70">YouClaw Runtime Check</div>
            <h1 className="text-3xl font-semibold tracking-tight">后端存活与端口连通性</h1>
            <p className="max-w-2xl text-sm leading-6 text-white/70">
              这个页面不加载正式业务前端，只持续检查 sidecar 是否拉起，以及当前端口是否能通过 <code>/api/health</code> 访问。
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <StatusCard
              label="Backend"
              value={isUp ? 'UP' : health.state === 'checking' ? 'CHECKING' : 'DOWN'}
              tone={isUp ? 'good' : health.state === 'checking' ? 'neutral' : 'bad'}
            />
            <StatusCard
              label="Port"
              value={portText}
              tone={isUp ? 'good' : 'neutral'}
            />
            <StatusCard
              label="HTTP /api/health"
              value={isUp ? 'Reachable' : 'Not Reachable'}
              tone={isUp ? 'good' : 'bad'}
            />
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-medium text-white/85">Connection</div>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-white/45">Base URL</dt>
                  <dd className="mt-1 font-mono text-cyan-100">{health.baseUrl}</dd>
                </div>
                <div>
                  <dt className="text-white/45">Last Checked</dt>
                  <dd className="mt-1 text-white/90">{lastCheckedText}</dd>
                </div>
                <div>
                  <dt className="text-white/45">HTTP Result</dt>
                  <dd className="mt-1 text-white/90">
                    {isUp ? '200 OK' : health.state === 'checking' ? 'Checking...' : health.error}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-medium text-white/85">Sidecar</div>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-white/45">Tauri Sidecar Status</dt>
                  <dd className="mt-1 text-white/90">{sidecar?.status ?? (isTauri ? 'pending' : 'browser mode')}</dd>
                </div>
                <div>
                  <dt className="text-white/45">Message</dt>
                  <dd className="mt-1 text-white/90">{sidecar?.message ?? 'No sidecar event yet'}</dd>
                </div>
                <div>
                  <dt className="text-white/45">Runtime</dt>
                  <dd className="mt-1 text-white/90">{health.details?.runtime ?? 'unknown'}</dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-5">
            <div className="text-sm font-medium text-white/85">Health Payload</div>
            <pre className="mt-4 overflow-x-auto text-xs leading-6 text-cyan-100/90">
              {JSON.stringify(health.details ?? {
                ok: false,
                error: health.error,
              }, null, 2)}
            </pre>
          </section>
        </div>
      </div>
    </main>
  )
}
