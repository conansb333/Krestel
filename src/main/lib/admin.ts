import { spawn } from 'node:child_process'
import { app } from 'electron'
import { runPowerShell, psq } from './ps'

export async function isAdmin(): Promise<boolean> {
  const result = await runPowerShell([
    '-Command',
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  ])
  return result.stdout.trim().toLowerCase().endsWith('true')
}

/**
 * Relaunch the current executable elevated.
 *
 * A detached PowerShell shim outlives this process and:
 *   1. waits for THIS process to fully exit (releases the single-instance lock),
 *   2. starts the exe with the RunAs verb (UAC prompt),
 *   3. if the UAC prompt is declined, starts the exe normally instead,
 *      so the app never ends up simply closed.
 */
export function relaunchElevated(): boolean {
  const exe = psq(process.execPath)
  const args = process.argv.slice(1).map((a) => `"${a}"`).join(' ')
  const argList = args.length > 0 ? ` -ArgumentList ${psq(args)}` : ''
  const psExe = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`

  const script = [
    `try { Wait-Process -Id ${process.pid} -Timeout 30 -ErrorAction SilentlyContinue } catch { }`,
    `$started = $false`,
    `try { Start-Process -FilePath ${exe}${argList} -Verb RunAs -ErrorAction Stop; $started = $true } catch { }`,
    `if (-not $started) {`,
    `  try { Start-Process -FilePath ${exe}${argList} -ErrorAction Stop } catch { }`,
    `}`
  ].join('\n')

  const child = spawn(psExe, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
  app.quit()
  return true
}
