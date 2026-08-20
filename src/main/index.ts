import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ActionMode, PlanOptions } from '../shared/types'
import { isAdmin, relaunchElevated } from './lib/admin'
import { deleteBackup, listBackups, openBackupsFolder } from './lib/backups'
import { buildExecutablePlan, type ExecutablePlan } from './lib/plans'
import { cancelRun, executePlan, isRunning } from './lib/runner'
import { loadSettings, saveSettings } from './lib/settings'
import { getStatus } from './lib/status'

let mainWindow: BrowserWindow | null = null
const executablePlans = new Map<string, ExecutablePlan>()

function sendEvent(event: Record<string, unknown>): void {
  mainWindow?.webContents.send('plan:event', event)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0f17',
    title: 'Krestel',
    icon: path.join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('sys:isAdmin', () => isAdmin())
  ipcMain.handle('sys:relaunchElevated', () => relaunchElevated())
  ipcMain.handle('sys:status', () => getStatus())
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, settings) => saveSettings(settings))
  ipcMain.handle('plan:build', async (_e, mode: ActionMode, override: Partial<PlanOptions>) => {
    const settings = await loadSettings()
    const executable = await buildExecutablePlan(settings, mode, override ?? {})
    executablePlans.set(executable.plan.id, executable)
    // keep the cache small
    if (executablePlans.size > 12) {
      const oldest = executablePlans.keys().next().value
      if (oldest) executablePlans.delete(oldest)
    }
    return executable.plan
  })
  ipcMain.handle('plan:run', async (_e, planId: string) => {
    const executable = executablePlans.get(planId)
    if (!executable) return { started: false, error: 'Plan not found - build it again.' }
    if (isRunning()) return { started: false, error: 'Another action is already running.' }
    executePlan(executable, (type, stepId, message) => {
      sendEvent({ type, planId, stepId, message, ts: Date.now() })
    }).catch((err) => {
      sendEvent({ type: 'run-error', planId, message: String(err), ts: Date.now() })
    })
    return { started: true }
  })
  ipcMain.handle('plan:cancel', () => cancelRun())
  ipcMain.handle('backups:list', () => listBackups())
  ipcMain.handle('backups:delete', (_e, name: string) => deleteBackup(name))
  ipcMain.handle('backups:openFolder', () => openBackupsFolder())
  ipcMain.handle('logs:export', async (_e, text: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    if (!win) return { saved: false }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const result = await dialog.showSaveDialog(win, {
      title: 'Export log',
      defaultPath: path.join(app.getPath('documents'), `defender-toolkit-log-${stamp}.txt`),
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await fs.writeFile(result.filePath, text, 'utf8')
    return { saved: true, path: result.filePath }
  })
  ipcMain.handle('open:external', (_e, url: string) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
