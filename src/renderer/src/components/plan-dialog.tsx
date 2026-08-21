import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  HardDriveDownload,
  Loader2,
  Rocket,
  ScrollText,
  ShieldAlert,
  XCircle
} from 'lucide-react'
import type { ActionMode, Plan } from '@shared/types'
import { api } from '@/lib/ipc'
import { useStore } from '@/state/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const MODE_LABEL: Record<ActionMode, string> = {
  disable: 'Disable Windows Defender',
  enable: 'Enable Windows Defender',
  remove: 'Remove Windows Defender',
  restore: 'Restore Windows Defender',
  backup: 'Create a backup now'
}

interface PlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: ActionMode
  backupDir?: string
}

export function PlanDialog({ open, onOpenChange, mode, backupDir }: PlanDialogProps): React.JSX.Element {
  const { status, run, startRun, cancelRun, logs, admin } = useStore()
  const [building, setBuilding] = useState(true)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [dryRun, setDryRun] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const activeRun = run !== null && run.plan.mode === mode && (plan === null || run.plan.id === plan.id) ? run : null

  const build = useCallback(
    async (withDryRun: boolean) => {
      setBuilding(true)
      try {
        const built = await api.buildPlan(mode, {
          dryRun: withDryRun,
          ...(backupDir ? { backupDir } : {})
        })
        setPlan(built)
      } catch (err) {
        toast.error(`Could not build plan: ${String(err)}`)
        onOpenChange(false)
      } finally {
        setBuilding(false)
      }
    },
    [mode, backupDir, onOpenChange]
  )

  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    if (!open) {
      setConfirmText('')
      setDryRun(false)
      return
    }
    setPlan(null)
    setConfirmText('')
    void buildRef.current(false)
    // only rebuild when the dialog (re)opens - not on every parent render
  }, [open])

  const onDryRunToggle = (checked: boolean): void => {
    setDryRun(checked)
    void build(checked)
  }

  const confirmOk = mode !== 'remove' || confirmText.trim().toUpperCase() === 'REMOVE'

  const canRun = plan !== null && confirmOk && (admin || activeRun !== null)

  const running = activeRun?.status === 'running'

  const doneCount = useMemo(() => {
    if (!activeRun) return 0
    return Object.values(activeRun.steps).filter((s) => s === 'done' || s === 'error').length
  }, [activeRun])

  const failedCount = useMemo(() => {
    if (!activeRun) return 0
    return Object.values(activeRun.steps).filter((s) => s === 'error').length
  }, [activeRun])

  const recentLogs = useMemo(() => logs.slice(-120).map((l) => l.text), [logs])

  const handleRun = async (): Promise<void> => {
    if (!plan) return
    const started = await startRun(plan)
    if (started && !plan.options.dryRun) {
      toast.info('Executing - watch the log for progress.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onOpenChange(o) }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'remove' ? <ShieldAlert className="h-5 w-5 text-destructive" /> : mode === 'backup' ? <HardDriveDownload className="h-5 w-5 text-emerald-500" /> : <Rocket className="h-5 w-5 text-primary" />}
            {MODE_LABEL[mode]}
            <Badge variant={mode === 'remove' ? 'destructive' : mode === 'disable' ? 'warning' : mode === 'enable' || mode === 'backup' ? 'success' : 'default'}>
              {mode.toUpperCase()}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {plan?.summary ?? 'Building the exact list of operations that will run on this machine...'}
          </DialogDescription>
        </DialogHeader>

        {building && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Building plan...
          </div>
        )}

        {!building && plan && !activeRun && (
          <div className="flex-1 min-h-0">
            <ScrollArea className="h-[46vh] pr-3">
              <div className="space-y-4">
                {plan.steps.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing to do - all relevant components are already in the target state.</p>
                )}
                <div className="space-y-2">
                  {plan.steps.map((step, i) => (
                    <div key={step.id} className="rounded-lg border p-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium leading-snug">{step.title}</p>
                            <Badge variant={step.risk === 'destructive' ? 'destructive' : step.risk === 'moderate' ? 'warning' : 'success'}>
                              {step.risk}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {plan.requiresReboot && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-500">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>A reboot is required after this action for changes to fully apply.</span>
                  </div>
                )}
                {mode === 'remove' && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Removal is destructive. Make sure a backup step is included (it is by default) or create a system
                      restore point. Keep in mind Windows updates may reinstall components.
                    </span>
                  </div>
                )}
                {status?.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-500">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <Separator className="my-4" />
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="dry-run" className="text-sm">Dry run</Label>
                  <p className="text-xs text-muted-foreground">Execute the plan without changing anything - logs what would happen.</p>
                </div>
                <Switch id="dry-run" checked={dryRun} onCheckedChange={onDryRunToggle} disabled={running} />
              </div>
              {mode === 'remove' && !dryRun && (
                <div className="space-y-1.5">
                  <Label htmlFor="confirm" className="text-sm text-destructive">
                    Type <span className="font-mono font-bold">REMOVE</span> to confirm destructive execution
                  </Label>
                  <Input
                    id="confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="REMOVE"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {!building && plan && activeRun && (
          <div className="flex-1 min-h-0 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className={cn('font-medium', failedCount > 0 && 'text-destructive')}>
                  {activeRun.status === 'running' && 'Executing...'}
                  {activeRun.status === 'done' && (failedCount > 0 ? `Completed with ${failedCount} failed step${failedCount === 1 ? '' : 's'}` : 'Completed')}
                  {activeRun.status === 'cancelled' && 'Cancelled'}
                  {activeRun.status === 'error' && `Failed${activeRun.error ? ` - ${activeRun.error}` : ''}`}
                </span>
                <span className="text-muted-foreground">
                  {doneCount} / {plan.steps.length} steps
                </span>
              </div>
              <Progress value={plan.steps.length > 0 ? (doneCount / plan.steps.length) * 100 : 0} />
            </div>
            <ScrollArea className="h-[30vh] rounded-lg border p-3">
              <div className="space-y-1.5">
                {plan.steps.map((step) => {
                  const state = activeRun.steps[step.id] ?? 'pending'
                  return (
                    <div key={step.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        {state === 'pending' && <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                        {state === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                        {state === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                        {state === 'error' && <XCircle className="h-3.5 w-3.5 text-destructive" />}
                        <span className={state === 'pending' ? 'text-muted-foreground' : ''}>{step.title}</span>
                      </div>
                      {state === 'error' && activeRun.errors[step.id] && (
                        <p className="mt-1 ml-5 break-words text-xs leading-relaxed text-destructive">
                          {activeRun.errors[step.id]}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ScrollText className="h-3.5 w-3.5" /> Live log
              </div>
              <ScrollArea className="h-[14vh] rounded-lg border bg-black/30 p-3">
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {recentLogs.length > 0 ? recentLogs.join('\n') : 'waiting for output...'}
                </pre>
              </ScrollArea>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {running ? (
            <Button variant="outline" onClick={cancelRun}>
              Cancel execution
            </Button>
          ) : activeRun ? (
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant={mode === 'remove' && !dryRun ? 'destructive' : 'default'}
                disabled={!canRun || building}
                onClick={() => void handleRun()}
              >
                {dryRun ? 'Start dry run' : mode === 'remove' ? 'Remove Defender' : mode === 'backup' ? 'Create backup' : `Run: ${mode}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
