import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'
import { app, shell } from 'electron'
import type { BackupInfo } from '../../shared/types'

export function backupsRoot(): string {
  return path.join(app.getPath('documents'), 'Krestel', 'backups')
}

export async function ensureBackupsRoot(): Promise<string> {
  const root = backupsRoot()
  await fs.mkdir(root, { recursive: true })
  return root
}

export async function createBackupDir(): Promise<string> {
  const root = await ensureBackupsRoot()
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15)
  const dir = path.join(root, `backup-${stamp}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export async function listBackups(): Promise<BackupInfo[]> {
  const root = backupsRoot()
  let entries: Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const backups: BackupInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    try {
      const files = await fs.readdir(dir, { withFileTypes: true })
      let fileCount = 0
      let sizeBytes = 0
      for (const f of files) {
        if (!f.isFile()) continue
        fileCount += 1
        sizeBytes += (await fs.stat(path.join(dir, f.name))).size
      }
      let manifest: BackupInfo['manifest'] = null
      try {
        // PowerShell 5.1 writes UTF-8 with a BOM; strip it or JSON.parse fails
        // (which surfaced as "unknown date" in the UI)
        const raw = (await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')).replace(/^\uFEFF/, '')
        manifest = JSON.parse(raw)
      } catch {
        manifest = null
      }
      // fall back to the backup folder's own modification time if no manifest,
      // so the UI never has to show "unknown date"
      let createdAt = manifest?.createdAt ? Date.parse(manifest.createdAt) || 0 : 0
      if (!createdAt) {
        try {
          createdAt = (await fs.stat(dir)).mtimeMs
        } catch {
          createdAt = 0
        }
      }
      backups.push({
        dir: entry.name,
        name: entry.name,
        createdAt,
        manifest,
        fileCount,
        sizeBytes
      })
    } catch {
      // unreadable entry: skip
    }
  }
  return backups.sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteBackup(name: string): Promise<boolean> {
  if (!/^backup-[\w.-]+$/.test(name)) return false
  await fs.rm(path.join(backupsRoot(), name), { recursive: true, force: true })
  return true
}

export async function openBackupsFolder(): Promise<void> {
  const root = await ensureBackupsRoot()
  await shell.openPath(root)
}
