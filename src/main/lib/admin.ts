import { spawn } from 'node:child_process'
import { runPowerShell, psq } from './ps'
import { crumb } from './diag'

export const RELAUNCH_ARG_PREFIX = '--krestel-relaunch'

export async function isAdmin(): Promise<boolean> {
  const result = await runPowerShell([
    '-Command',
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  ])
  return result.stdout.trim().toLowerCase().endsWith('true')
}

let elevationRequested = false

/**
 * Relaunch the app elevated WITHOUT ever leaving the user without a window:
 *
 *  1. THIS app stays running (Chromium's job object kills detached children at
 *     app exit, so any helper that must outlive us is a dead end).
 *  2. A helper immediately starts a new instance with the RunAs verb (UAC
 *     prompt appears over the running app), tagged with a relaunch marker.
 *     If the prompt is declined it starts the instance normally instead.
 *  3. The new instance sees the marker, waits for us to release the
 *     single-instance lock, and takes over.
 *  4. We receive the marker in 'second-instance' and quit - by then the
 *     helper has already finished, so its death with us is irrelevant.
 * Result: elevated restart on accept, normal restart on decline, and if
 * nothing ever starts (prompt ignored), this window simply stays open.
 */
/** Builds the elevation helper (exposed for tests). */
export function buildElevationScript(exePath: string, pid: number): { psExe: string; args: string[]; script: string } {
  const exe = psq(exePath)
  const args = [...process.argv.slice(1), `${RELAUNCH_ARG_PREFIX}=${pid}`]
    .map((a) => `"${a}"`)
    .join(' ')
  const argList = ` -ArgumentList ${psq(args)}`
  const psExe = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  // [IO.Path]::GetTempPath() resolves the real temp dir via the Win32 API,
  // immune to broken TEMP/TMP env values (e.g. MSYS-style /tmp).
  const script = [
    "$log = Join-Path ([System.IO.Path]::GetTempPath()) 'krestel-elevate.log'",
    `Add-Content -Path $log -Value ('' + (Get-Date -Format o) + ' shim start, old pid=${pid}')`,
    '$started = $false',
    `try { Start-Process -FilePath ${exe}${argList} -Verb RunAs -ErrorAction Stop; $started = $true } catch { Add-Content -Path $log -Value ('' + (Get-Date -Format o) + ' runas failed: ' + $_.Exception.Message) }`,
    'if (-not $started) {',
    `  try { Start-Process -FilePath ${exe}${argList} -ErrorAction Stop; $started = $true } catch { Add-Content -Path $log -Value ('' + (Get-Date -Format o) + ' fallback failed: ' + $_.Exception.Message) }`,
    '}',
    "Add-Content -Path $log -Value ('' + (Get-Date -Format o) + ' shim done, started=' + $started)"
  ].join('\n')
  return { psExe, args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], script }
}

export function relaunchElevated(): boolean {
  if (elevationRequested) return true
  elevationRequested = true

  const { psExe, args } = buildElevationScript(process.execPath, process.pid)
  try {
    // NOT detached on purpose: packaged Electron kills detached children
    // immediately via its job object. This helper only needs to outlive the
    // UAC prompt, and the app deliberately stays alive until the new
    // instance takes over - so a plain child is exactly right here.
    const child = spawn(psExe, args, {
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('error', (err) => crumb(`elevation helper spawn error: ${String(err)}`))
    crumb(`elevation helper spawned, pid=${child.pid ?? 'n/a'}`)
  } catch (err) {
    crumb(`elevation helper spawn threw: ${String(err)}`)
    return false
  }
  // deliberately NOT quitting here - see the doc comment above
  return true
}
