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

/** Relaunch the current executable with a UAC prompt and quit this instance. */
export function relaunchElevated(): boolean {
  const exe = process.execPath
  const args = process.argv.slice(1)
  const argList = args.length > 0 ? ` -ArgumentList ${psq(args.map((a) => `"${a}"`).join(' '))}` : ''
  const command = `Start-Process -FilePath ${psq(exe)}${argList} -Verb RunAs`
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-Command', 'try { ' + command + ' } catch { exit 1 }'],
    { detached: true, windowsHide: true, stdio: 'ignore' }
  )
  child.unref()
  setTimeout(() => app.quit(), 900)
  return true
}
