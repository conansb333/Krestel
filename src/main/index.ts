import { promises as fs } from 'node:fs'
import { spawn as spawnChild } from 'node:child_process'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ActionMode, PlanOptions } from '../shared/types'
import { buildElevationScript, isAdmin, relaunchElevated, RELAUNCH_ARG_PREFIX } from './lib/admin'
import { backupsRoot, deleteBackup, listBackups, openBackupsFolder } from './lib/backups'
import { buildExecutablePlan, type ExecutablePlan } from './lib/plans'
import { cancelRun, executePlan, isRunning } from './lib/runner'
import { loadSettings, saveSettings } from './lib/settings'
import { getStatus } from './lib/status'

let mainWindow: BrowserWindow | null = null
const executablePlans = new Map<string, ExecutablePlan>()

const DEBUG_LOG = path.join(process.env.TEMP ?? process.cwd(), 'krestel-startup.log')
function crumb(msg: string): void {
  try {
    require('node:fs').appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* best effort */
  }
}
crumb(`--- main loaded, packaged=${app.isPackaged}, argv=${JSON.stringify(process.argv)}, krestel-env=${JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => k.includes('KRESTEL'))))}`)

// Keep dev instances away from the packaged app's userData. Windows paths are
// case-insensitive, so without this a dev electron ("krestel") and the packaged
// app ("Krestel") share one Chromium singleton lock and silently block each other.
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Krestel-Dev'))
}

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
  mainWindow.on('ready-to-show', () => {
    crumb('window ready-to-show')
    mainWindow?.show()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.on('closed', () => {
    crumb('window closed')
    mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    crumb(`loading renderer file: ${path.join(__dirname, '../renderer/index.html')}`)
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    crumb(`did-fail-load ${code} ${desc} ${url}`)
  })
}

app.whenReady().then(async () => {
  crumb('app ready')
  let gotLock = app.requestSingleInstanceLock()
  crumb(`single-instance lock: ${gotLock}`)
  if (!gotLock && process.argv.some((a) => a.startsWith(RELAUNCH_ARG_PREFIX))) {
    // Elevation handover: a previous instance launched us and is quitting now.
    // Poll until its lock is released, then take over (verified in test/locktest.cjs).
    crumb('relauncher mode: waiting for the previous instance to exit')
    const deadline = Date.now() + 30_000
    while (!gotLock && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      gotLock = app.requestSingleInstanceLock()
    }
    if (!gotLock) {
      crumb('QUIT: relauncher timed out waiting for the lock')
      app.quit()
      return
    }
    crumb('relauncher acquired the lock')
  }
  if (!gotLock) {
    crumb('QUIT: no single-instance lock')
    app.quit()
    return
  }
  crumb('registering IPC handlers')
  app.on('second-instance', (_e, argv) => {
    crumb(`second-instance: ${JSON.stringify(argv)}`)
    if (argv.some((a) => a.startsWith(RELAUNCH_ARG_PREFIX))) {
      // the elevated/relaunched replacement is up - hand over and exit
      app.quit()
      return
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('sys:isAdmin', () => isAdmin())
  ipcMain.handle('sys:relaunchElevated', () => {
    crumb('IPC sys:relaunchElevated CALLED')
    return relaunchElevated()
  })
  // automated test hook: KRESTEL_TEST_ELEVATE=1 triggers the elevation flow 2s after start
  if (process.env.KRESTEL_TEST_ELEVATE === '1') {
    setTimeout(() => {
      crumb('test hook: calling relaunchElevated')
      relaunchElevated()
    }, 2000)
  }
  // diagnostic twin: same helper mechanics (harmless target, no RunAs) with
  // piped stdio, to expose why silent spawns die in the packaged app
  if (process.env.KRESTEL_TEST_TWIN === '1') {
    setTimeout(() => {
      const twinBuilt = buildElevationScript('C:\\Windows\\System32\\wusa.exe', process.pid)
      const twinArgs = twinBuilt.args.slice(0, 5).concat([twinBuilt.script.replaceAll(' -Verb RunAs', '')])
      const twin = spawnChild(twinBuilt.psExe, twinArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
      twin.stdout?.on('data', (d: Buffer) => crumb(`twin stdout: ${String(d).slice(0, 300)}`))
      twin.stderr?.on('data', (d: Buffer) => crumb(`twin stderr: ${String(d).slice(0, 300)}`))
      twin.on('error', (e: Error) => crumb(`twin error: ${String(e)}`))
      twin.on('close', (c: number | null) => crumb(`twin exited: ${c}`))
      crumb('twin spawned')
    }, 2000)
  }
  ipcMain.handle('sys:status', () => getStatus())
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, settings) => saveSettings(settings))
  ipcMain.handle('plan:build', async (_e, mode: ActionMode, override: Partial<PlanOptions>) => {
    const settings = await loadSettings()
    const resolved: Partial<PlanOptions> = { ...override }
    // the Backups page passes the folder NAME - resolve it against the backups
    // root so the restore steps receive an absolute path
    if (resolved.backupDir && !path.isAbsolute(resolved.backupDir)) {
      if (/^[\w.-]+$/.test(resolved.backupDir)) {
        resolved.backupDir = path.join(backupsRoot(), resolved.backupDir)
      } else {
        resolved.backupDir = undefined
      }
    }
    const executable = await buildExecutablePlan(settings, mode, resolved)
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
      defaultPath: path.join(app.getPath('documents'), `krestel-log-${stamp}.txt`),
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
  crumb('window-all-closed -> quit')
  app.quit()
})
app.on('before-quit', () => {
  crumb('before-quit')
})
