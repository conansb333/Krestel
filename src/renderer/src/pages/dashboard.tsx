import { useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Cpu,
  History,
  Lock,
  Power,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Bug
} from 'lucide-react'
import type { ActionMode } from '@shared/types'
import { useStore } from '@/state/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PlanDialog } from '@/components/plan-dialog'
import { cn } from '@/lib/utils'

function StatusCard({
  title,
  value,
  sub,
  icon,
  tone
}: {
  title: string
  value: string
  sub?: string
  icon: React.ReactNode
  tone: 'good' | 'bad' | 'warn' | 'neutral'
}): React.JSX.Element {
  const toneClass = {
    good: 'text-emerald-500',
    bad: 'text-destructive',
    warn: 'text-amber-500',
    neutral: 'text-muted-foreground'
  }[tone]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center justify-between">
          {title}
          <span className={toneClass}>{icon}</span>
        </CardDescription>
        <CardTitle className={cn('text-xl', toneClass)}>{value}</CardTitle>
      </CardHeader>
      {sub && (
        <CardContent>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </CardContent>
      )}
    </Card>
  )
}

export function DashboardPage({ onNavigate }: { onNavigate: (page: string) => void }): React.JSX.Element {
  const { status, statusLoading, refreshStatus, admin, settings } = useStore()
  const [dialogMode, setDialogMode] = useState<ActionMode | null>(null)

  const protectionState = (): { value: string; tone: 'good' | 'bad' | 'warn' | 'neutral'; sub: string } => {
    if (!status) return { value: 'Unknown', tone: 'neutral', sub: '' }
    const winDefend = status.services.find((s) => s.name === 'WinDefend')
    if (!status.defender.installed || winDefend?.exists === false) {
      return {
        value: 'Defender removed',
        tone: 'bad',
        sub: status.thirdPartyAV.some((a) => a.enabled)
          ? `Third-party AV active: ${status.thirdPartyAV.filter((a) => a.enabled).map((a) => a.name).join(', ')}`
          : 'No antivirus active on this machine.'
      }
    }
    if (status.defender.realtimeEnabled === true) return { value: 'Protected', tone: 'good', sub: `Engine ${status.defender.engineVersion ?? '?'} · signatures ${status.defender.signatureVersion ?? '?'}` }
    if (status.policies.disableAntiSpyware || status.policies.realtimeDisabled)
      return { value: 'Disabled by policy', tone: 'warn', sub: 'Use Enable to restore protection.' }
    if (status.defender.realtimeEnabled === false) return { value: 'Real-time protection off', tone: 'bad', sub: '' }
    return { value: 'Unknown', tone: 'neutral', sub: '' }
  }

  const protection = protectionState()
  const winDefend = status?.services.find((s) => s.name === 'WinDefend')
  const tamper = status?.defender.tamperProtection ?? 'unknown'
  const thirdPartyActive = status?.thirdPartyAV.filter((a) => a.enabled) ?? []

  const actions: Array<{
    mode: ActionMode
    title: string
    description: string
    icon: React.ReactNode
    className: string
    buttonVariant: 'default' | 'outline' | 'destructive' | 'secondary'
  }> = [
    {
      mode: 'disable',
      title: 'Disable',
      description: 'Stop real-time protection and services via policy. Fully reversible.',
      icon: <Power className="h-5 w-5" />,
      className: 'border-amber-500/40 hover:border-amber-500/70',
      buttonVariant: 'outline'
    },
    {
      mode: 'enable',
      title: 'Enable',
      description: 'Remove policy overrides and bring Defender back to life.',
      icon: <ShieldCheck className="h-5 w-5" />,
      className: 'border-emerald-500/40 hover:border-emerald-500/70',
      buttonVariant: 'outline'
    },
    {
      mode: 'remove',
      title: 'Remove',
      description: 'Permanently delete services, drivers, files and the Security app. Backs up first.',
      icon: <Trash2 className="h-5 w-5" />,
      className: 'border-destructive/40 hover:border-destructive/80',
      buttonVariant: 'destructive'
    },
    {
      mode: 'restore',
      title: 'Restore',
      description: 'Restore from a backup, or re-register built-in components.',
      icon: <History className="h-5 w-5" />,
      className: 'border-primary/40 hover:border-primary/70',
      buttonVariant: 'outline'
    }
  ]

  return (
    <div className="space-y-6">
      {!admin && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
            <div className="flex-1">
              <p className="text-sm font-medium">Not running as administrator</p>
              <p className="text-xs text-muted-foreground">
                Use the shield button in the top bar to relaunch with elevated privileges - all actions need admin rights.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Current protection state of this machine.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshStatus()} disabled={statusLoading}>
          {statusLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {statusLoading && !status ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-2 pt-6">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatusCard
            title="Protection"
            value={protection.value}
            sub={protection.sub}
            tone={protection.tone}
            icon={protection.tone === 'good' ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
          />
          <StatusCard
            title="Real-time protection"
            value={
              status?.defender.realtimeEnabled === true ? 'Active' : status?.defender.realtimeEnabled === false ? 'Off' : 'Unknown'
            }
            sub={status?.defender.amRunningMode ? `Running mode: ${status.defender.amRunningMode}` : undefined}
            tone={status?.defender.realtimeEnabled === true ? 'good' : status?.defender.realtimeEnabled === false ? 'bad' : 'neutral'}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatusCard
            title="Tamper protection"
            value={tamper === 'on' ? 'On' : tamper === 'off' ? 'Off' : 'Unknown'}
            sub={tamper === 'on' ? 'Must be turned off in Windows Security before most changes.' : undefined}
            tone={tamper === 'on' ? 'warn' : 'neutral'}
            icon={<Lock className="h-4 w-4" />}
          />
          <StatusCard
            title="Antivirus service"
            value={winDefend ? (winDefend.state === 'Running' ? 'Running' : winDefend.startMode) : 'Not installed'}
            sub={
              thirdPartyActive.length > 0
                ? `Third-party: ${thirdPartyActive.map((a) => a.name).join(', ')}`
                : 'No third-party antivirus registered.'
            }
            tone={winDefend?.state === 'Running' ? 'good' : winDefend?.exists ? 'warn' : 'bad'}
            icon={<Bug className="h-4 w-4" />}
          />
        </div>
      )}

      {status && status.warnings.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-amber-500">
              <AlertTriangle className="h-4 w-4" /> Warnings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {status.warnings.map((w, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                - {w}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Actions</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {actions.map((a) => (
            <Card key={a.mode} className={cn('flex flex-col', a.className)}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {a.icon}
                  {a.title}
                  {a.mode === 'remove' && <Badge variant="destructive">destructive</Badge>}
                </CardTitle>
                <CardDescription className="min-h-[3rem] text-xs leading-relaxed">{a.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button
                  className="w-full"
                  variant={a.buttonVariant}
                  disabled={!admin}
                  onClick={() => setDialogMode(a.mode)}
                >
                  {a.mode === 'remove' ? 'Remove Defender...' : a.mode === 'disable' ? 'Disable...' : a.mode === 'enable' ? 'Enable...' : 'Restore...'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Every action shows a full preview of the operations before anything runs.{' '}
          <button className="underline underline-offset-2 hover:text-foreground" onClick={() => onNavigate('components')}>
            Configure included components
          </button>{' '}
          before removing (currently {settings ? Object.values(settings.components).filter(Boolean).length + ' selected' : '...'}).
        </p>
      </div>

      {status && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-4 w-4 text-muted-foreground" /> System
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">OS</span>
              <span className="text-right">{status.os.caption}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Build</span>
              <span className="text-right font-mono">
                {status.os.build}
                {status.os.isWin11 && <Badge variant="secondary" className="ml-2">Windows 11</Badge>}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Architecture</span>
              <span className="text-right font-mono">{status.os.arch}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">PowerShell</span>
              <span className="text-right font-mono">{status.os.psVersion}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Engine version</span>
              <span className="text-right font-mono">{status.defender.engineVersion ?? '-'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Signatures</span>
              <span className="text-right font-mono">
                {status.defender.signatureVersion ?? '-'}
                {status.defender.signatureAge !== null && ` (${status.defender.signatureAge}d old)`}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Security app</span>
              <span className="text-right">{status.appxInstalled ? `SecHealthUI ${status.appxVersion ?? ''}` : 'not installed'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Scheduled tasks</span>
              <span className="text-right">{status.tasks.length} found</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Drivers</span>
              <span className="text-right">{status.drivers.filter((d) => d.exists).length} / 3 present</span>
            </div>
          </CardContent>
        </Card>
      )}

      <PlanDialog open={dialogMode !== null} onOpenChange={(o) => { if (!o) setDialogMode(null) }} mode={dialogMode ?? 'disable'} />
    </div>
  )
}
