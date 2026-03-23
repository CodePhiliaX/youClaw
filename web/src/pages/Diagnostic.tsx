import { useEffect, useState } from 'react'
import { getTauriInvoke, isTauri } from '@/api/transport'

type SidecarStatus = {
  status: string
  message: string
  port?: number | null
  runtime?: string | null
  log_dir?: string | null
  mode?: string | null
}

type HealthPayload = {
  signature: string
  status: string
  mode: string
  runtime: string
  port: number
  pid: number
  platform: string
  arch: string
  uptime: number
  startedAt: string
  execPath: string
  nodeVersion: string | null
  bunVersion: string | null
  runtimeVersion: string | null
  logDir: string | null
  logFile: string | null
  tempDir: string | null
}

const invoke = isTauri ? getTauriInvoke() : null

async function fetchStatus(): Promise<SidecarStatus | null> {
  if (!invoke) return null
  return invoke('get_sidecar_status') as Promise<SidecarStatus>
}

async function fetchHealth(port?: number | null): Promise<HealthPayload | null> {
  if (!port) return null
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(800),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Health request failed: ${res.status}`)
  }
  const payload = await res.json() as HealthPayload
  if (payload.signature !== 'youclaw-diagnostic-v1') {
    throw new Error(`Port ${port} returned HTTP 200, but it is not the YouClaw diagnostic server`)
  }
  if (payload.mode !== 'diagnostic') {
    throw new Error(`Port ${port} is occupied by a non-diagnostic service (mode=${payload.mode || 'unknown'})`)
  }
  return payload
}

export function Diagnostic() {
  const [sidecar, setSidecar] = useState<SidecarStatus | null>(null)
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauri || !invoke) return

    let disposed = false
    let cleanup: (() => void) | null = null

    const refresh = async () => {
      try {
        const status = await fetchStatus()
        if (!status || disposed) return
        setSidecar(status)

        if (status.status === 'ready' && status.port) {
          try {
            const payload = await fetchHealth(status.port)
            if (!disposed) {
              setHealth(payload)
              setHealthError(null)
            }
          } catch (err) {
            if (!disposed) {
              setHealth(null)
              setHealthError(err instanceof Error ? err.message : String(err))
            }
          }
        } else if (!disposed) {
          setHealth(null)
          setHealthError(null)
        }
      } catch (err) {
        if (!disposed) {
          setHealth(null)
          setHealthError(err instanceof Error ? err.message : String(err))
        }
      }
    }

    void refresh()
    const interval = window.setInterval(() => {
      void refresh()
    }, 1500)

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<SidecarStatus>('sidecar-event', (event) => {
        if (disposed) return
        setSidecar(event.payload)
        if (event.payload.status !== 'pending') {
          setSwitchingTo(null)
        }
        if (event.payload.status !== 'ready') {
          setHealth(null)
        }
        if (event.payload.status === 'ready' && event.payload.port) {
          void fetchHealth(event.payload.port)
            .then((payload) => {
              if (!disposed) {
                setHealth(payload)
                setHealthError(null)
              }
            })
            .catch((err) => {
              if (!disposed) {
                setHealth(null)
                setHealthError(err instanceof Error ? err.message : String(err))
              }
            })
        }
      }).then((fn) => {
        cleanup = fn
      })
    })

    return () => {
      disposed = true
      cleanup?.()
      window.clearInterval(interval)
    }
  }, [])

  const handleSwitch = async (runtime: 'bun' | 'node22') => {
    if (!invoke) return
    setSwitchingTo(runtime)
    try {
      const next = await invoke('switch_sidecar_runtime', { runtime }) as SidecarStatus
      setSidecar(next)
      if (next.port) {
        const payload = await fetchHealth(next.port)
        setHealth(payload)
        setHealthError(null)
      }
    } catch (err) {
      setHealth(null)
      setHealthError(err instanceof Error ? err.message : String(err))
    } finally {
      setSwitchingTo(null)
    }
  }

  const activeRuntime = health?.runtime || sidecar?.runtime || 'unknown'
  const status = sidecar?.status || 'pending'
  const logPath = health?.logDir || sidecar?.log_dir || '-'
  const logFile = health?.logFile || '-'
  const blockedByOtherService = !!healthError && (
    healthError.includes('non-diagnostic service') ||
    healthError.includes('not the YouClaw diagnostic server')
  )

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#e2f3ff,_#f7f8fb_45%,_#eef1f6)] px-6 py-10 text-slate-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="rounded-[28px] border border-white/70 bg-white/80 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.28em] text-sky-700">YouClaw Diagnostics</p>
              <h1 className="mt-2 font-serif text-4xl leading-tight">Windows runtime health check</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                这个包只验证本地 sidecar 是否能被拉起。你可以直接在这里切换 `bun` 和 `node22`，应用会先停掉旧服务，再启动新的服务。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-400 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleSwitch('bun')}
                disabled={switchingTo !== null || activeRuntime === 'bun'}
              >
                {switchingTo === 'bun' ? 'Starting Bun...' : 'Use Bun'}
              </button>
              <button
                className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                onClick={() => void handleSwitch('node22')}
                disabled={switchingTo !== null || activeRuntime === 'node22'}
              >
                {switchingTo === 'node22' ? 'Starting Node22...' : 'Use Node22'}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
          <section className="rounded-[28px] border border-slate-200 bg-white/85 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
            <div className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full ${status === 'ready' ? 'bg-emerald-500' : status === 'pending' ? 'bg-amber-500' : 'bg-rose-500'}`} />
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Server Status</p>
            </div>
            <p className="mt-4 text-3xl font-semibold">{status}</p>
            <p className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">{sidecar?.message || 'Waiting for backend status...'}</p>
            {blockedByOtherService && (
              <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                当前端口已经被别的本地服务占用了。先退出旧的 YouClaw 或手动释放 `62601`，再试一次。
              </p>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Metric label="Active Runtime" value={activeRuntime} />
              <Metric label="Port" value={String(health?.port || sidecar?.port || '-')} />
              <Metric label="PID" value={health?.pid ? String(health.pid) : '-'} />
              <Metric label="Mode" value={health?.mode || sidecar?.mode || '-'} />
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-slate-950 p-8 text-white shadow-[0_20px_60px_rgba(2,6,23,0.16)]">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-200">Diagnostics</p>
            <dl className="mt-5 space-y-4 text-sm">
              <Detail label="Node version" value={health?.nodeVersion || '-'} />
              <Detail label="Bun version" value={health?.bunVersion || '-'} />
              <Detail label="Platform" value={health ? `${health.platform} / ${health.arch}` : '-'} />
              <Detail label="Executable" value={health?.execPath || '-'} />
              <Detail label="Started At" value={health?.startedAt || '-'} />
              <Detail label="Log Directory" value={logPath} />
              <Detail label="Log File" value={logFile} />
              <Detail label="Temp Directory" value={health?.tempDir || '-'} />
            </dl>
          </section>
        </div>

        <section className="rounded-[28px] border border-slate-200 bg-white/85 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">Health Endpoint</p>
          {health ? (
            <pre className="mt-4 overflow-x-auto rounded-3xl bg-slate-950 p-5 text-xs leading-6 text-sky-100">
              {JSON.stringify(health, null, 2)}
            </pre>
          ) : (
            <p className="mt-4 text-sm leading-6 text-slate-600">
              {healthError || 'Health payload is not available yet.'}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 break-all text-base font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.2em] text-sky-200/70">{label}</dt>
      <dd className="mt-1 break-all text-sm leading-6 text-white">{value}</dd>
    </div>
  )
}
