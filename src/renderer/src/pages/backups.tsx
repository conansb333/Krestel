import { useState } from 'react'
import { FolderOpen, HardDriveDownload, History, Trash2 } from 'lucide-react'
import { useStore } from '@/state/store'
import { api } from '@/lib/ipc'
import { formatBytes, formatDate } from '@/lib/format'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { PlanDialog } from '@/components/plan-dialog'
import { toast } from 'sonner'

export function BackupsPage(): React.JSX.Element {
  const { backups, refreshBackups, admin } = useStore()
  const [restoreDir, setRestoreDir] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    const ok = await api.deleteBackup(deleteTarget)
    if (ok) toast.success(`Deleted ${deleteTarget}`)
    else toast.error('Could not delete backup')
    setDeleteTarget(null)
    await refreshBackups()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
          <p className="text-sm text-muted-foreground">
            Registry exports, service manifests and scheduled task XML - created before each removal, or any time you want.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={!admin} onClick={() => setCreateOpen(true)}>
            <HardDriveDownload className="h-4 w-4" /> Create backup
          </Button>
          <Button variant="outline" size="sm" onClick={() => void api.openBackupsFolder()}>
            <FolderOpen className="h-4 w-4" /> Open folder
          </Button>
        </div>
      </div>

      {backups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <History className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No backups yet</p>
            <p className="max-w-md text-xs text-muted-foreground">
              A backup is created automatically before every Remove action (unless disabled in Components). You can also
              create one right now - it is read-only and safe to run at any time.
            </p>
            <Button size="sm" className="mt-2" disabled={!admin} onClick={() => setCreateOpen(true)}>
              <HardDriveDownload className="h-4 w-4" /> Create backup now
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="max-h-[62vh] pr-3">
          <div className="space-y-3">
            {backups.map((b) => (
              <Card key={b.dir}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="font-mono text-sm font-medium">{b.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      {b.manifest?.components?.slice(0, 3).map((c) => (
                        <Badge key={c} variant="secondary">{c}</Badge>
                      ))}
                      {(b.manifest?.components?.length ?? 0) > 3 && (
                        <Badge variant="outline">+{(b.manifest?.components?.length ?? 0) - 3}</Badge>
                      )}
                    </div>
                  </div>
                  <CardDescription>
                    {formatDate(b.createdAt)} · {b.fileCount} files · {formatBytes(b.sizeBytes)}
                  </CardDescription>
                </CardHeader>
                <Separator />
                <CardContent className="flex gap-2 pt-4">
                  <Button size="sm" disabled={!admin} onClick={() => setRestoreDir(b.dir)}>
                    <History className="h-4 w-4" /> Restore from this backup
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeleteTarget(b.dir)}>
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      <PlanDialog
        open={createOpen}
        onOpenChange={(o) => { if (!o) setCreateOpen(false) }}
        mode="backup"
      />

      <PlanDialog
        open={restoreDir !== null}
        onOpenChange={(o) => { if (!o) setRestoreDir(null) }}
        mode="restore"
        backupDir={restoreDir ?? undefined}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget} will be removed permanently. Restoring Defender from it will no longer be possible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
              Delete backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
