import { useEffect, useState } from 'react'
import {
  CircleUser,
  CloudUpload,
  FolderArchive,
  LayoutDashboard,
  ListChecks,
  Moon,
  ScrollText,
  Settings2,
  ShieldCheck,
  ShieldQuestion,
  Sun
} from 'lucide-react'
import { StoreProvider, useStore } from '@/state/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { DashboardPage } from '@/pages/dashboard'
import { ComponentsPage } from '@/pages/components'
import { BackupsPage } from '@/pages/backups'
import { LogsPage } from '@/pages/logs'
import { HelpPage } from '@/pages/help'
import { cn } from '@/lib/utils'
import logoUrl from '@/assets/logo.png'

type Page = 'dashboard' | 'components' | 'backups' | 'logs' | 'help'

const NAV: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'components', label: 'Components', icon: <ListChecks className="h-4 w-4" /> },
  { id: 'backups', label: 'Backups', icon: <FolderArchive className="h-4 w-4" /> },
  { id: 'logs', label: 'Logs', icon: <ScrollText className="h-4 w-4" /> },
  { id: 'help', label: 'Help & Safety', icon: <ShieldQuestion className="h-4 w-4" /> }
]

function AppShell(): React.JSX.Element {
  const { admin, elevating, relaunchElevated, run, demo, version } = useStore()
  const [page, setPage] = useState<Page>('dashboard')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    const saved = window.localStorage.getItem('krestel-theme')
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const toggleTheme = (): void => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      window.localStorage.setItem('krestel-theme', next)
      return next
    })
  }

  const running = run?.status === 'running'

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
            <img src={logoUrl} alt="Krestel" className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Krestel</p>
            <p className="text-[11px] text-muted-foreground">v{version || '1.0.0'}</p>
          </div>
        </div>
        {demo && (
          <div className="px-5 pb-2">
            <Badge variant="warning" className="w-full justify-center">DEMO MODE</Badge>
          </div>
        )}
        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                page === item.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4">
          {running ? (
            <div className="flex items-center gap-2 text-xs text-primary">
              <CloudUpload className="h-3.5 w-3.5 animate-pulse" />
              {run?.plan.mode} running...
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CircleUser className="h-3.5 w-3.5" />
              {admin ? 'Elevated (admin)' : 'Standard user'}
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={cn('font-medium', page === 'dashboard' ? 'text-foreground' : undefined)}>
              {NAV.find((n) => n.id === page)?.label}
            </span>
            {run && run.status !== 'running' && (
              <Badge variant={run.status === 'done' ? 'success' : run.status === 'error' ? 'destructive' : 'secondary'}>
                last run: {run.status}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!admin ? (
              <Button size="sm" variant="outline" className="border-amber-500/50 text-amber-500 hover:text-amber-400" disabled={elevating} onClick={() => void relaunchElevated()}>
                <ShieldCheck className="h-4 w-4" />
                {elevating ? 'Waiting for UAC...' : 'Restart as administrator'}
              </Button>
            ) : (
              <Badge variant="success" className="gap-1.5">
                <ShieldCheck className="h-3 w-3" /> Administrator
              </Badge>
            )}
            <Button size="icon" variant="ghost" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          {page === 'dashboard' && <DashboardPage onNavigate={(p) => setPage(p as Page)} />}
          {page === 'components' && <ComponentsPage />}
          {page === 'backups' && <BackupsPage />}
          {page === 'logs' && <LogsPage />}
          {page === 'help' && <HelpPage />}
        </main>
        <footer className="flex h-8 shrink-0 items-center justify-between border-t px-6 text-[11px] text-muted-foreground">
          <span>Use at your own risk - always keep a backup or restore point.</span>
          <span className="flex items-center gap-1">
            <Settings2 className="h-3 w-3" /> MIT licensed
          </span>
        </footer>
      </div>
      <Toaster position="bottom-right" />
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <AppShell />
    </StoreProvider>
  )
}
