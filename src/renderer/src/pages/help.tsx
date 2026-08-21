import { BookOpen, ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useStore } from '@/state/store'
import { api } from '@/lib/ipc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

// Updated to the final repository location
const GITHUB_URL = 'https://github.com/conansb333/krestel'

export function HelpPage(): React.JSX.Element {
  const { version, demo } = useStore()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Help & Safety</h1>
        <p className="text-sm text-muted-foreground">
          Krestel v{version || '...'}
          {demo && <Badge variant="warning" className="ml-2">DEMO MODE - no real system changes</Badge>}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-amber-500" /> Before you disable or remove Defender
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            Windows Defender is your machine's built-in protection. If you turn it off or remove it, install another
            antivirus (or accept the risk deliberately). The dashboard warns you when no third-party AV is registered.
          </p>
          <p>
            <span className="text-foreground font-medium">Tamper Protection</span> must be turned off first:
            Windows Security → Virus &amp; threat protection → Manage settings → Tamper Protection → Off. While it is
            on, Windows blocks service and policy changes and this app can only report the failure.
          </p>
          <p>
            Prefer <span className="text-foreground font-medium">Disable</span> over Remove: it is instantly reversible
            with one click. Remove deletes files, drivers, scheduled tasks and the Security app; updates may partially
            reinstall them later.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-500" /> How this app keeps you safe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-inside space-y-2 text-sm leading-relaxed text-muted-foreground">
            <li>Every action shows the full list of operations before anything executes.</li>
            <li>Dry-run mode executes the plan without changing the system and shows what would happen.</li>
            <li>Automatic backups (registry .reg exports, service manifests, task XML) before every removal.</li>
            <li>One-click Restore from any backup, including re-registering the Windows Security app.</li>
            <li>Optional system restore point before changes, and sfc/DISM repair during restore.</li>
            <li>Destructive actions require typing a confirmation word.</li>
          </ul>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-muted-foreground" /> FAQ
          </CardTitle>
          <CardDescription>Short answers to the most common questions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <div>
            <p className="font-medium">Which Windows versions are supported?</p>
            <p className="text-muted-foreground">
              Windows 10 (all feature updates, build 10240+) and Windows 11, x64 / x86 / ARM64. The app detects the
              build and adapts: e.g. the Security app package only exists on 1809+. Older versions (7/8.1) use a
              different Defender stack and are reported as unsupported.
            </p>
          </div>
          <div>
            <p className="font-medium">Why did some steps fail with "access denied"?</p>
            <p className="text-muted-foreground">
              Almost always Tamper Protection. Turn it off in Windows Security and run the action again - steps are
              idempotent, so re-running is safe.
            </p>
          </div>
          <div>
            <p className="font-medium">Windows Update reinstalled parts of Defender. Now what?</p>
            <p className="text-muted-foreground">
              Cumulative updates restore platform files and appx packages. Simply run the Remove action again after the
              update, or keep Defender disabled-by-policy which updates cannot revert.
            </p>
          </div>
          <div>
            <p className="font-medium">Can I get Defender back after removing files without a backup?</p>
            <p className="text-muted-foreground">
              Restore with the "repair system files" option enabled (sfc + DISM). If that is not enough, an in-place
              upgrade (setup.exe keeping files and apps) fully reinstalls Defender.
            </p>
          </div>
          <div>
            <p className="font-medium">Does removal affect Windows Update?</p>
            <p className="text-muted-foreground">
              The Security Center integration may show warnings, and definition updates stop (there is nothing to
              update). Regular quality updates keep working.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-xs text-muted-foreground">
            Open source under the MIT license. Source code, documentation and releases live on GitHub.
          </p>
          <Button variant="outline" size="sm" onClick={() => void api.openExternal(GITHUB_URL)}>
            <ExternalLink className="h-3.5 w-3.5" /> Krestel on GitHub
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
