// Two experiments run as a real Electron main process:
//   1. DETACH: does a detached PowerShell child survive the Electron app's exit?
//      (It survives Node-parent exits; Chromium may kill it via its job object.)
//   2. LOCK-RETRY: can a second instance that FAILED requestSingleInstanceLock()
//      acquire it later by polling, once the first instance quits?
//      (This is the foundation for an elevation relaunch that never needs the
//      helper to outlive the app.)
// Usage: set LOCKTEST_ROLE=detach|first|second, then run with electron.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const role = process.env.LOCKTEST_ROLE || 'detach'
const tmp = os.tmpdir()
const marker = (name) => path.join(tmp, `locktest-${name}.txt`)

if (role === 'detach') {
  const { app } = require('electron')
  app.setPath('userData', path.join(tmp, 'locktest-detach'))
  try { fs.unlinkSync(marker('detach')) } catch {}
  // detached child writes a marker 3s AFTER this app exits (app quits in 500ms)
  spawn('powershell.exe', ['-NoProfile', '-Command',
    `Start-Sleep 3; Set-Content -Path '${marker('detach').replace(/'/g, "''")}' -Value 'survived'`],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  setTimeout(() => app.quit(), 500)
  return
}

const { app } = require('electron')
const shared = path.join(tmp, 'locktest-shared')
fs.mkdirSync(shared, { recursive: true })

if (role === 'first') {
  app.setPath('userData', shared)
  const got = app.requestSingleInstanceLock()
  fs.writeFileSync(marker('first-lock'), String(got))
  // hold the lock for 5 seconds, then quit
  setTimeout(() => app.quit(), 5000)
  app.whenReady().then(() => { /* windowless */ })
}

if (role === 'second') {
  app.setPath('userData', shared)
  const firstTry = app.requestSingleInstanceLock()
  fs.writeFileSync(marker('second-first-try'), String(firstTry))
  if (firstTry) {
    fs.writeFileSync(marker('second-result'), 'unexpectedly-got-lock-immediately')
    app.quit()
  } else {
    const started = Date.now()
    const retry = () => {
      if (app.requestSingleInstanceLock()) {
        fs.writeFileSync(marker('second-result'), `acquired-after-${((Date.now() - started) / 1000).toFixed(1)}s`)
        app.quit()
      } else if (Date.now() - started > 20000) {
        fs.writeFileSync(marker('second-result'), 'TIMEOUT-never-acquired')
        app.quit()
      } else {
        setTimeout(retry, 250)
      }
    }
    setTimeout(retry, 250)
  }
  app.whenReady().then(() => { /* windowless */ })
}

// role=elevate-harmless: Electron app spawns the REAL elevation helper
// (RunAs stripped, target = wusa.exe which exits silently) with the exact
// spawn options, keeps the app ALIVE, then quits - verifies shim mechanics
// under Electron without any UAC prompt.
if (role === 'elevate-harmless') {
  const { app } = require('electron')
  const { spawn } = require('node:child_process')
  app.setPath('userData', path.join(tmp, 'locktest-elevate'))
  const { buildElevationScript } = require('../out-test/admin.cjs')
  const built = buildElevationScript('C:\Windows\System32\wusa.exe', process.pid)
  const args = built.args.slice(0, 5).concat([built.script.replaceAll(' -Verb RunAs', '')])
  try {
    const child = spawn(built.psExe, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (e) => fs.writeFileSync(marker('elevate-harmless'), 'spawn-error: ' + e.message))
    child.unref()
    fs.writeFileSync(marker('elevate-harmless'), 'spawned pid=' + (child.pid || 'na'))
  } catch (e) {
    fs.writeFileSync(marker('elevate-harmless'), 'threw: ' + e.message)
  }
  setTimeout(() => app.quit(), 8000)
  app.whenReady().then(() => {})
}
