import type { ActionMode, AppSettings, BackupInfo, DefenderStatus, Plan, PlanOptions, RunEvent } from './types'

/** Bridge surface exposed to the renderer via contextBridge. */
export interface KrestelApi {
  platform: 'electron'
  appVersion: string
  isAdmin(): Promise<boolean>
  relaunchElevated(): Promise<boolean>
  getStatus(): Promise<DefenderStatus>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>
  buildPlan(mode: ActionMode, override?: Partial<PlanOptions>): Promise<Plan>
  runPlan(planId: string): Promise<{ started: boolean; error?: string }>
  cancelRun(): void
  onRunEvent(callback: (event: RunEvent) => void): () => void
  listBackups(): Promise<BackupInfo[]>
  deleteBackup(name: string): Promise<boolean>
  openBackupsFolder(): Promise<void>
  exportLogs(text: string): Promise<{ saved: boolean; path?: string }>
  openExternal(url: string): Promise<void>
}

declare global {
  interface Window {
    krestel?: KrestelApi
  }
}
