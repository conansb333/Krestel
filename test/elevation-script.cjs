// Validates the elevation helper script:
//  1. syntax-check the REAL script (with RunAs) via the PowerShell tokenizer
//  2. execute a harmless variant (RunAs stripped, target = wusa.exe which exits
//     silently) and verify the log breadcrumbs get written and Start-Process succeeds
const { spawnSync } = require('node:child_process')
const { writeFileSync, readFileSync, unlinkSync, existsSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { buildElevationScript } = require('../out-test/admin.cjs')

const exe = 'C:\\Windows\\System32\\wusa.exe'
const built = buildElevationScript(exe, process.pid)
const psExe = built.psExe

// 1) syntax check of the real script
const file = path.join(os.tmpdir(), 'krestel-elevate-syntax.ps1')
writeFileSync(file, '\ufeff' + built.script, 'utf8')
const syn = spawnSync(psExe, ['-NoProfile', '-Command',
  `$e = $null; $t = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw '${file.replace(/'/g, "''")}'), [ref]$e); if ($e -and $e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 } else { 'SYNTAX OK' }`],
  { encoding: 'utf8' })
console.log('syntax:', (syn.stdout || syn.stderr).trim())
if (syn.status !== 0) process.exit(1)

// 2) execute the harmless variant (RunAs removed)
const logPath = path.join(os.tmpdir(), 'krestel-elevate.log')
if (existsSync(logPath)) unlinkSync(logPath)
const harmless = built.script.replaceAll(' -Verb RunAs', '')
const run = spawnSync(psExe, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', harmless], { encoding: 'utf8' })
console.log('exit:', run.status)
if (run.stderr.trim()) console.log('stderr:', run.stderr.trim().slice(0, 400))
console.log('--- log contents:')
console.log(readFileSync(logPath, 'utf8'))
