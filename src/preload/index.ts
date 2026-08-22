import { contextBridge, ipcRenderer } from 'electron'
import type { RunEvent } from '../shared/types'

const api = {
  platform: 'electron' as const,
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  isAdmin: (): Promise<boolean> => ipcRenderer.invoke('sys:isAdmin'),
  relaunchElevated: (): Promise<boolean> => ipcRenderer.invoke('sys:relaunchElevated'),
  getStatus: () => ipcRenderer.invoke('sys:status'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
  buildPlan: (mode: string, override?: Record<string, unknown>) => ipcRenderer.invoke('plan:build', mode, override),
  runPlan: (planId: string) => ipcRenderer.invoke('plan:run', planId),
  cancelRun: () => ipcRenderer.invoke('plan:cancel'),
  onRunEvent: (callback: (event: RunEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: RunEvent): void => callback(event)
    ipcRenderer.on('plan:event', listener)
    return () => ipcRenderer.removeListener('plan:event', listener)
  },
  listBackups: () => ipcRenderer.invoke('backups:list'),
  deleteBackup: (name: string) => ipcRenderer.invoke('backups:delete', name),
  openBackupsFolder: () => ipcRenderer.invoke('backups:openFolder'),
  exportLogs: (text: string) => ipcRenderer.invoke('logs:export', text),
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url)
}

contextBridge.exposeInMainWorld('krestel', api)
