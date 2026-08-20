import { useEffect, useRef, useState } from 'react'
import { Download, Eraser, ScrollText } from 'lucide-react'
import { useStore } from '@/state/store'
import { api } from '@/lib/ipc'
import { formatClock } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'

const KIND_CLASS: Record<string, string> = {
  info: 'text-foreground/80',
  step: 'text-primary',
  error: 'text-destructive',
  system: 'text-amber-500'
}

export function LogsPage(): React.JSX.Element {
  const { logs, clearLogs, logText } = useStore()
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, autoScroll])

  const exportLogs = async (): Promise<void> => {
    const result = await api.exportLogs(logText)
    if (result.saved) toast.success(`Log saved to ${result.path}`)
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="text-sm text-muted-foreground">Everything the engine has reported this session.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAutoScroll((s) => !s)}>
            {autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportLogs()}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={clearLogs}>
            <Eraser className="h-4 w-4" /> Clear
          </Button>
        </div>
      </div>

      <Card className="flex-1 min-h-0">
        <CardContent className="h-full p-0">
          <ScrollArea className="h-full">
            <div className="p-4 font-mono text-xs leading-relaxed">
              {logs.length === 0 && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <ScrollText className="h-4 w-4" /> No output yet - run an action to see the engine log here.
                </p>
              )}
              {logs.map((l, i) => (
                <div key={i} className="flex gap-3">
                  <span className="shrink-0 text-muted-foreground/60">{formatClock(l.ts)}</span>
                  <span className={KIND_CLASS[l.kind] ?? ''}>{l.text}</span>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
