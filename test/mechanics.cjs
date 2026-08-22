// Synthetic mechanics test - validates the NEW engine operations against safe
// dummy targets (no Defender involvement, nothing touches the real system
// beyond disposable test artifacts). The generated script runs ELEVATED once.
//   1. registry-based service disable (dummy service kresteltestsvc)
//   2. ownership takeover on a TrustedInstaller-owned test tree + deletion
//   3. boot-deletion queue for a file locked by another process (then cleaned up)
const { writeFileSync, readFileSync, unlinkSync, existsSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { buildExecutablePlan } = require('../out-test/plans.cjs')

const root = path.resolve(__dirname, '..')
const resultFile = path.join(root, 'out-test', 'mechanics-result.txt')
const testDir = path.join(os.tmpdir(), 'krestel-mechanics-test')
const lockedFile = path.join(testDir, 'sub', 'locked.bin')
const PS = (p) => p.replaceAll('\\', '\\\\').replaceAll("'", "''")
const TD = PS(testDir)
const LF = PS(lockedFile)
const RF = PS(resultFile)

const allOn = {
  services: true, securityHealth: true, drivers: true, tasks: true, appx: true,
  filesProgram: true, filesData: true, atp: true, telemetry: true, smartScreen: true
}

function stepPs(plan, needle) {
  const step = plan.steps.find((s) => s.title.toLowerCase().includes(needle))
  if (!step) throw new Error(`step not found: ${needle}`)
  return step.ps
}

async function main() {
  const settings = { components: allOn, options: { restorePoint: false, backup: false, repairSystem: false } }
  const disable = await buildExecutablePlan(settings, 'disable', {})
  const remove = await buildExecutablePlan(settings, 'remove', { backup: false })

  const svcPs = stepPs(disable, 'disable antivirus services') // real registry-disable code
  let ownPs = stepPs(remove, 'take ownership of program files').join('\n')
  ownPs = ownPs.split("'C:\\Program Files\\Windows Defender'").join(`'${TD}'`)
  let rmPs = stepPs(remove, 'delete program files')
  rmPs = rmPs.map((l) => l.split("'C:\\Program Files\\Windows Defender'").join(`'${TD}'`))

  const script = `
$ErrorActionPreference = 'Continue'
$out = @()
function Log([string]$m) { Write-Host ("LOG: " + $m) }
function RK($m) { $script:out += $m; Write-Host $m }

# --- 1) registry-based service disable on a dummy service -------------------
New-Item -ItemType Directory -Force -Path '${TD}' | Out-Null
sc.exe create kresteltestsvc binpath= 'C:\\Windows\\System32\\cmd.exe' start= demand | Out-Null
$key = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\kresteltestsvc'
if (-not (Test-Path $key)) { RK 'SVC-SETUP-FAIL' } else {
${svcPs.join('\n').replaceAll("'WinDefend', 'WdNisSvc'", "'kresteltestsvc'")}
  $start = (Get-ItemProperty $key -Name Start).Start
  RK ("SVC-START-VALUE=" + $start)
  sc.exe delete kresteltestsvc | Out-Null
}

# --- 2) ownership of a TrustedInstaller-owned tree + delete -----------------
Set-Content -Path (Join-Path '${TD}' 'normal.txt') -Value 'x'
New-Item -ItemType Directory -Force -Path (Split-Path '${LF}') | Out-Null
Set-Content -Path '${LF}' -Value 'locked-content'
icacls '${TD}' /setowner 'NT SERVICE\\TrustedInstaller' /t /c /q | Out-Null
icacls '${TD}' /remove 'BUILTIN\\Users' 'BUILTIN\\Administrators' /t /c /q 2>&1 | Out-Null
RK ("OWN-SETUP-OWNER-CHANGED=" + (Test-Path (Join-Path '${TD}' 'normal.txt')))
${ownPs}
Remove-Item -LiteralPath (Join-Path '${TD}' 'normal.txt') -Force -ErrorAction SilentlyContinue
RK ("OWN-NORMAL-DELETED=" + (-not (Test-Path (Join-Path '${TD}' 'normal.txt'))))

# --- 3) boot-deletion queue for a locked file -------------------------------
$env:KRESTEL_LOCK_PATH = '${LF}'
$locker = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','$h=[System.IO.File]::Open($env:KRESTEL_LOCK_PATH,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); Start-Sleep 60'
Start-Sleep 2
$sm = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager'
$pfroBefore = (Get-ItemProperty $sm -Name PendingFileRenameOperations -ErrorAction SilentlyContinue).PendingFileRenameOperations
$p = '${TD}'
${rmPs.join('\n')}
$pfroAfter = (Get-ItemProperty $sm -Name PendingFileRenameOperations -ErrorAction SilentlyContinue).PendingFileRenameOperations
$queued = @($pfroAfter | Where-Object { $_ -like '*locked.bin' }).Count
RK ("QUEUE-ENTRY-PRESENT=" + ($queued -gt 0))
RK ("QUEUE-LOCKED-FILE-STILL-THERE=" + (Test-Path '${LF}'))
Stop-Process -Id $locker.Id -Force -ErrorAction SilentlyContinue
# cleanup: restore PFRO to its prior state and remove test dir
if ($null -eq $pfroBefore) { Remove-ItemProperty $sm -Name PendingFileRenameOperations -ErrorAction SilentlyContinue }
else { Set-ItemProperty $sm -Name PendingFileRenameOperations -Value $pfroBefore -Type MultiString }
Start-Sleep 1
Remove-Item -LiteralPath '${TD}' -Recurse -Force -ErrorAction SilentlyContinue
RK ("CLEANUP-DIR-GONE=" + (-not (Test-Path '${TD}')))
RK 'DONE'
Set-Content -Path '${RF}' -Value ($out -join [Environment]::NewLine)
`
  writeFileSync(path.join(root, 'out-test', 'mechanics-run.ps1'), '\ufeff' + script, 'utf8')
  if (existsSync(resultFile)) unlinkSync(resultFile)
  console.log('script written; run it elevated (a UAC prompt will appear)')
}

void main()
