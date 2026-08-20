// Verifies the elevation-relaunch mechanics WITHOUT triggering a UAC prompt:
//  - exact same shim structure as admin.ts (detached powershell, Wait-Process,
//    Start-Process, quoting), but without -Verb RunAs
//  - a short-lived "old app" process exits immediately; the shim must survive
//    its death and start Krestel.exe afterwards
// Also syntax-validates the REAL RunAs script via the PowerShell tokenizer.
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const exe = path.join(root, 'dist', 'win-unpacked', 'Krestel.exe')
const psExe = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`

function psq(s) {
  return "'" + s.replace(/'/g, "''") + "'"
}

function buildScript(pid, withRunAs) {
  const argList = ''
  const verb = withRunAs ? ' -Verb RunAs' : ''
  return [
    `try { Wait-Process -Id ${pid} -Timeout 30 -ErrorAction SilentlyContinue } catch { }`,
    `$started = $false`,
    `try { Start-Process -FilePath ${psq(exe)}${argList}${verb} -ErrorAction Stop; $started = $true } catch { }`,
    `if (-not $started) {`,
    `  try { Start-Process -FilePath ${psq(exe)}${argList} -ErrorAction Stop } catch { }`,
    `}`
  ].join('\n')
}

// 1) syntax-check the REAL (RunAs) script without executing it
const realScript = buildScript(4, true)
const scriptFile = path.join(root, 'out-test', 'runas-script-check.ps1')
require('node:fs').mkdirSync(path.join(root, 'out-test'), { recursive: true })
require('node:fs').writeFileSync(scriptFile, '\ufeff' + realScript, 'utf8')
const syntax = spawnSync(
  psExe,
  [
    '-NoProfile',
    '-Command',
    `$e = $null
     $t = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw '${scriptFile.replace(/'/g, "''")}'), [ref]$e)
     if ($e -and $e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 } else { 'SYNTAX OK (' + $t.Count + ' tokens)' }`
  ],
  { encoding: 'utf8' }
)
console.log('syntax check:', (syntax.stdout || '').trim() || (syntax.stderr || '').trim())
if (syntax.status !== 0) process.exit(1)

// 2) mechanics: shim (no RunAs) survives parent death and starts Krestel.exe
const shimScript = buildScript(process.pid, false)
const child = spawn(psExe, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', shimScript], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true
})
child.unref()
console.log(`old app pid ${process.pid} exiting now; shim should wait then start Krestel.exe`)
// this process exits ~1s later; poll for Krestel.exe from a separate checker below

const checker = spawn(
  psExe,
  [
    '-NoProfile',
    '-Command',
    `$deadline = (Get-Date).AddSeconds(25); $found = $false
     while ((Get-Date) -lt $deadline) {
       if (Get-Process Krestel -ErrorAction SilentlyContinue) { $found = $true; break }
       Start-Sleep -Milliseconds 500
     }
     $result = if ($found) { 'OK' } else { 'FAIL' }
     Set-Content -Path '${path.join(root, 'out-test', 'relaunch-result.txt').replace(/'/g, "''")}' -Value $result
     if ($found) { Stop-Process -Name Krestel -Force -ErrorAction SilentlyContinue }`
  ],
  { detached: true, stdio: 'ignore', windowsHide: true }
)
checker.unref()
setTimeout(() => process.exit(0), 1200)
