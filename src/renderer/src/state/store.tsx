import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { AppSettings, BackupInfo, DefenderStatus, Plan, RunEvent } from '@shared/types'
import { api, isDemoMode } from '@/lib/ipc'
import { toast } from 'sonner'

export interface LogLine {
  ts: number
  text: string
  kind: 'info' | 'step' | 'error' | 'system'
}

export type StepState = 'pending' | 'running' | 'done' | 'error'

export interface RunState {
  plan: Plan
  steps: Record<string, StepState>
  errors: Record<string, string>
  status: 'running' | 'done' | 'cancelled' | 'error'
  startedAt: number
  endedAt?: number
  error?: string
}

interface Store {
  demo: boolean
  admin: boolean
  version: string
  status: DefenderStatus | null
  statusLoading: boolean
  refreshStatus: () => Promise<void>
  settings: AppSettings | null
  patchSettings: (next: AppSettings) => Promise<void>
  logs: LogLine[]
  clearLogs: () => void
  logText: string
  run: RunState | null
  startRun: (plan: Plan) => Promise<boolean>
  cancelRun: () => void
  backups: BackupInfo[]
  refreshBackups: () => Promise<void>
  elevating: boolean
  relaunchElevated: () => Promise<void>
}

const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const value = useContext(StoreContext)
  if (!value) throw new Error('StoreProvider missing')
  return value
}

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [admin, setAdmin] = useState(true)
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<DefenderStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [run, setRun] = useState<RunState | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [elevating, setElevating] = useState(false)
  const runRef = useRef<RunState | null>(null)
  runRef.current = run

  const appendLogs = useCallback((lines: LogLine[]): void => {
    setLogs((prev) => [...prev, ...lines].slice(-4000))
  }, [])

  const refreshStatus = useCallback(async (): Promise<void> => {
    setStatusLoading(true)
    try {
      const next = await api.getStatus()
      setStatus(next)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const refreshBackups = useCallback(async (): Promise<void> => {
    setBackups(await api.listBackups())
  }, [])

  const patchSettings = useCallback(async (next: AppSettings): Promise<void> => {
    setSettings(next)
    await api.saveSettings(next)
  }, [])

  const startRun = useCallback(
    async (plan: Plan): Promise<boolean> => {
      if (runRef.current?.status === 'running') {
        toast.error('Another action is already running.')
        return false
      }
      const steps: Record<string, StepState> = {}
      for (const s of plan.steps) steps[s.id] = 'pending'
      const next: RunState = { plan, steps, errors: {}, status: 'running', startedAt: Date.now() }
      runRef.current = next
      setRun(next)
      appendLogs([
        { ts: Date.now(), kind: 'system', text: `── ${plan.mode.toUpperCase()} started (${plan.steps.length} steps${plan.options.dryRun ? ', DRY RUN' : ''}) ──` }
      ])
      const result = await api.runPlan(plan.id)
      if (!result.started) {
        const failed: RunState = { ...next, status: 'error', endedAt: Date.now(), error: result.error }
        runRef.current = failed
        setRun(failed)
        appendLogs([{ ts: Date.now(), kind: 'error', text: result.error ?? 'failed to start' }])
        toast.error(result.error ?? 'Failed to start')
        return false
      }
      return true
    },
    [appendLogs]
  )

  const cancelRun = useCallback((): void => {
    void api.cancelRun()
    appendLogs([{ ts: Date.now(), kind: 'system', text: 'Cancellation requested...' }])
  }, [appendLogs])

  useEffect(() => {
    const unsubscribe = api.onRunEvent((event: RunEvent) => {
      if (event.type === 'log') {
        appendLogs([{ ts: event.ts, kind: 'info', text: event.message ?? '' }])
        return
      }
      if (event.type === 'step-start' || event.type === 'step-done' || event.type === 'step-error') {
        const stepId = event.stepId ?? ''
        const current = runRef.current
        if (current && event.planId === current.plan.id) {
          const next: RunState = { ...current, steps: { ...current.steps }, errors: { ...current.errors } }
          if (event.type === 'step-start') next.steps[stepId] = 'running'
          else if (event.type === 'step-done') next.steps[stepId] = 'done'
          else {
            next.steps[stepId] = 'error'
            next.errors[stepId] = event.message ?? 'unknown error'
          }
          runRef.current = next
          setRun(next)
        }
        const step = current?.plan.steps.find((s) => s.id === stepId)
        if (step) {
          const kind = event.type === 'step-error' ? 'error' : 'step'
          const suffix = event.type === 'step-error' ? ` — ${event.message ?? ''}` : ''
          appendLogs([{ ts: event.ts, kind, text: `${step.title}${suffix}` }])
        }
        return
      }
      if (event.type === 'run-start') return
      if (event.type === 'run-done' || event.type === 'run-cancelled' || event.type === 'run-error') {
        const current = runRef.current
        const failedSteps = current ? Object.values(current.steps).filter((s) => s === 'error').length : 0
        if (current) {
          const next: RunState = {
            ...current,
            status: event.type === 'run-done' ? 'done' : event.type === 'run-cancelled' ? 'cancelled' : 'error',
            endedAt: event.ts,
            error: event.message
          }
          runRef.current = next
          setRun(next)
        }
        const suffix = event.type === 'run-done' && failedSteps > 0 ? ` (${failedSteps} step${failedSteps === 1 ? '' : 's'} FAILED - check the log)` : ''
        const label = event.type === 'run-done' ? `completed${suffix}` : event.type === 'run-cancelled' ? 'cancelled' : `failed: ${event.message ?? 'unknown error'}`
        appendLogs([{ ts: event.ts, kind: event.type === 'run-error' ? 'error' : 'system', text: `── Action ${label} ──` }])
        if (event.type === 'run-done') {
          if (failedSteps > 0) {
            toast.warning(`Completed with ${failedSteps} failed step${failedSteps === 1 ? '' : 's'} - open the log for details.`)
          } else {
            toast.success('Action completed. A reboot may be required.')
          }
        }
        if (event.type === 'run-error') toast.error(`Action failed: ${event.message ?? 'unknown error'}`)
        void refreshStatus()
        void refreshBackups()
      }
    })
    return unsubscribe
  }, [appendLogs, refreshBackups, refreshStatus])

  useEffect(() => {
    void (async () => {
      appendLogs([{ ts: Date.now(), kind: 'system', text: 'Krestel started.' }])
      const [isAdmin, appSettings] = await Promise.all([api.isAdmin(), api.getSettings()])
      setAdmin(isAdmin)
      setSettings(appSettings)
      try {
        setVersion(await Promise.resolve(api.appVersion))
      } catch {
        setVersion('')
      }
      await Promise.all([refreshStatus(), refreshBackups()])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const relaunchElevated = useCallback(async (): Promise<void> => {
    setElevating(true)
    appendLogs([
      {
        ts: Date.now(),
        kind: 'system',
        text: 'Restarting elevated: this window closes, then Windows shows a UAC prompt. If you decline it, the app restarts normally instead.'
      }
    ])
    await api.relaunchElevated()
  }, [appendLogs])

  const logText = useMemo(() => logs.map((l) => `[${new Date(l.ts).toLocaleTimeString(undefined, { hour12: false })}] ${l.text}`).join('\n'), [logs])

  const value = useMemo<Store>(
    () => ({
      demo: isDemoMode,
      admin,
      version,
      status,
      statusLoading,
      refreshStatus,
      settings,
      patchSettings,
      logs,
      clearLogs: () => setLogs([]),
      logText,
      run,
      startRun,
      cancelRun,
      backups,
      refreshBackups,
      elevating,
      relaunchElevated
    }),
    [
      admin,
      version,
      status,
      statusLoading,
      refreshStatus,
      settings,
      patchSettings,
      logs,
      logText,
      run,
      startRun,
      cancelRun,
      backups,
      refreshBackups,
      elevating,
      relaunchElevated
    ]
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
