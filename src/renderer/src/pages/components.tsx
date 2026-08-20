import { HardDriveDownload, RotateCcw, Settings2, ShieldAlert } from 'lucide-react'
import type { AppSettings, ComponentId } from '@shared/types'
import { COMPONENT_META } from '@shared/types'
import { useStore } from '@/state/store'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

const COMPONENT_ORDER: ComponentId[] = [
  'services',
  'securityHealth',
  'drivers',
  'tasks',
  'appx',
  'filesProgram',
  'filesData',
  'atp',
  'telemetry',
  'smartScreen'
]

export function ComponentsPage(): React.JSX.Element {
  const { settings, patchSettings } = useStore()

  if (!settings) {
    return <div className="text-sm text-muted-foreground">Loading settings...</div>
  }

  const toggleComponent = (id: ComponentId, checked: boolean): void => {
    const next: AppSettings = { ...settings, components: { ...settings.components, [id]: checked } }
    void patchSettings(next)
  }

  const toggleOption = (key: 'restorePoint' | 'backup' | 'repairSystem', checked: boolean): void => {
    const next: AppSettings = { ...settings, options: { ...settings.options, [key]: checked } }
    void patchSettings(next)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Components</h1>
        <p className="text-sm text-muted-foreground">
          Choose which Defender components are touched by <span className="text-foreground">Remove</span> (all that are
          enabled) and <span className="text-foreground">Disable</span> (services, Security Health, telemetry,
          SmartScreen).
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {COMPONENT_ORDER.map((id) => {
          const meta = COMPONENT_META[id]
          const checked = settings.components[id]
          return (
            <Card key={id} className={checked ? undefined : 'opacity-70'}>
              <CardContent className="flex items-start justify-between gap-4 py-5">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium leading-none">{meta.label}</p>
                    <Badge variant={meta.risk === 'destructive' ? 'destructive' : meta.risk === 'moderate' ? 'warning' : 'success'}>
                      {meta.risk}
                    </Badge>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{meta.description}</p>
                </div>
                <Switch checked={checked} onCheckedChange={(c) => toggleComponent(id, c)} aria-label={meta.label} />
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-muted-foreground" /> Safety options
          </CardTitle>
          <CardDescription>Applied to every run. Preview and dry-run are always available in the action dialog.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm">Create system restore point</Label>
              <p className="text-xs text-muted-foreground">
                Checkpoint-Computer before the first change. Windows allows only one restore point every 24 hours by default.
              </p>
            </div>
            <Switch checked={settings.options.restorePoint} onCheckedChange={(c) => toggleOption('restorePoint', c)} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm">Back up before removal</Label>
              <p className="text-xs text-muted-foreground">
                Exports every affected registry key, service/driver config and scheduled task to Documents\Defender
                Toolkit\backups so Restore can bring them back.
              </p>
            </div>
            <Switch checked={settings.options.backup} onCheckedChange={(c) => toggleOption('backup', c)} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm">Repair system files during restore</Label>
              <p className="text-xs text-muted-foreground">
                Adds sfc /scannow and DISM RestoreHealth to the restore plan - can take 30+ minutes but repairs deleted
                Defender binaries.
              </p>
            </div>
            <Switch checked={settings.options.repairSystem} onCheckedChange={(c) => toggleOption('repairSystem', c)} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-500/40">
        <CardContent className="space-y-3 py-5">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-500">
            <ShieldAlert className="h-4 w-4" /> Good to know
          </p>
          <ul className="list-inside space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>
              <HardDriveDownload className="mr-1 inline h-3 w-3" />
              Windows cumulative updates may reinstall removed appx packages and platform files - re-run the tool afterwards if needed.
            </li>
            <li>
              <RotateCcw className="mr-1 inline h-3 w-3" />
              Removing files & drivers without a backup means only an in-place upgrade or DISM repair can bring Defender back.
            </li>
            <li>Tamper Protection blocks most changes while it is on - disable it in Windows Security first.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
