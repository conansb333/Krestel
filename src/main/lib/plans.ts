import type { ActionMode, AppSettings, Plan, PlanOptions, PlanStep } from '../../shared/types'
import { psq } from './ps'
import { backupsRoot, createBackupDir } from './backups'

export interface StepDef extends PlanStep {
  /** PowerShell lines executed inside a try/catch wrapper. */
  ps: string[]
  /** Per-step wall-clock budget in seconds. */
  timeoutSec: number
}

export interface ExecutablePlan {
  plan: Plan
  steps: StepDef[]
}

let seq = 0

function pushStep(
  steps: StepDef[],
  id: string,
  title: string,
  detail: string,
  risk: PlanStep['risk'],
  group: PlanStep['group'],
  ps: string[],
  timeoutSec = 300
): void {
  steps.push({ id: `${id}-${++seq}`, title, detail, risk, group, ps, timeoutSec })
}

// ---------------------------------------------------------------------------
// Reusable PowerShell fragments
// ---------------------------------------------------------------------------

const POLICY_ROOT = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender'

const disablePoliciesPs = (): string[] => [
  `$root = '${POLICY_ROOT}'`,
  'New-Item -Path $root -Force | Out-Null',
  'Set-ItemProperty -Path $root -Name DisableAntiSpyware -Value 1 -Type DWord',
  'Set-ItemProperty -Path $root -Name DisableAntiVirus -Value 1 -Type DWord',
  '$rtp = Join-Path $root "Real-Time Protection"',
  'New-Item -Path $rtp -Force | Out-Null',
  'Set-ItemProperty -Path $rtp -Name DisableRealtimeMonitoring -Value 1 -Type DWord',
  'Set-ItemProperty -Path $rtp -Name DisableBehaviorMonitoring -Value 1 -Type DWord',
  'Set-ItemProperty -Path $rtp -Name DisableIOAVProtection -Value 1 -Type DWord',
  'Set-ItemProperty -Path $rtp -Name DisableScriptScanning -Value 1 -Type DWord',
  'Set-ItemProperty -Path $rtp -Name DisableScanOnRealtimeEnable -Value 1 -Type DWord',
  'Log "Group policy keys set (DisableAntiSpyware / DisableAntiVirus / RTP overrides)."'
]

const disableSpynetPs = (): string[] => [
  `$sp = Join-Path '${POLICY_ROOT}' 'Spynet'`,
  'New-Item -Path $sp -Force | Out-Null',
  'Set-ItemProperty -Path $sp -Name SpynetReporting -Value 0 -Type DWord',
  'Set-ItemProperty -Path $sp -Name SubmitSamplesConsent -Value 2 -Type DWord',
  'Set-ItemProperty -Path $sp -Name DisableBlockAtFirstSeen -Value 1 -Type DWord',
  'Log "MAPS/SpyNet reporting disabled; sample submission set to never."'
]

const disableSmartScreenPs = (): string[] => [
  "$ss = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System'",
  'New-Item -Path $ss -Force | Out-Null',
  'Set-ItemProperty -Path $ss -Name EnableSmartScreen -Value 0 -Type DWord',
  "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer' -Name SmartScreenEnabled -Value 'Off'",
  'Log "SmartScreen policy set to Off."'
]

const stopAndDisablePs = (names: string[]): string[] => {
  const list = names.map((n) => `'${n}'`).join(', ')
  return [
    `foreach ($s in ${list}) {`,
    '  $svc = Get-Service -Name $s -ErrorAction SilentlyContinue',
    '  if ($svc) {',
    '    Log ("Stopping service " + $s)',
    '    sc.exe stop $s | Out-Null',
    '    Log ("Disabling service " + $s)',
    '    sc.exe config $s start= disabled | Out-Null',
    '    Log ("  exit code: " + $LASTEXITCODE + " (5=access denied -> disable Tamper Protection first)")',
    '  } else { Log ("Service " + $s + " not present (already removed?)") }',
    '}'
  ]
}

const restorePointPs = (): string[] => [
  'Log "Creating system restore point..."',
  "Checkpoint-Computer -RestorePointType 'MODIFY_SETTINGS' -Description 'Krestel: before Defender changes' -ErrorAction Stop | Out-Null",
  'Log "Restore point created."'
]

const takeOwnershipPrelude = (): string[] => [
  '# Enable SeTakeOwnershipPrivilege / SeRestorePrivilege so we can re-ACL Defender files',
  'if (-not ([System.Management.Automation.PSTypeName]"Krestel.Priv").Type) {',
  'Add-Type -TypeDefinition @\'',
  'using System;',
  'using System.Runtime.InteropServices;',
  'namespace Krestel {',
  '  public class Priv {',
  '    [DllImport("advapi32.dll", SetLastError=true)]',
  '    static extern bool OpenProcessToken(IntPtr h, uint acc, out IntPtr tok);',
  '    [DllImport("advapi32.dll", SetLastError=true)]',
  '    static extern bool LookupPrivilegeValue(string sys, string name, out long lid);',
  '    [DllImport("advapi32.dll", SetLastError=true)]',
  '    static extern bool AdjustTokenPrivileges(IntPtr tok, bool dis, ref TOKPRIV1LUID newst, int len, IntPtr prev, IntPtr ret);',
  '    [StructLayout(LayoutKind.Sequential, Pack=1)]',
  '    struct TOKPRIV1LUID { public int Count; public long Luid; public int Attr; }',
  '    public static void Enable(string priv) {',
  '      IntPtr tok;',
  '      OpenProcessToken(System.Diagnostics.Process.GetCurrentProcess().Handle, 0x28, out tok);',
  '      TOKPRIV1LUID tp; tp.Count = 1; tp.Attr = 2;',
  '      LookupPrivilegeValue(null, priv, out tp.Luid);',
  '      AdjustTokenPrivileges(tok, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);',
  '    }',
  '  }',
  '}',
  '\'@',
  '}',
  '[Krestel.Priv]::Enable("SeTakeOwnershipPrivilege")',
  '[Krestel.Priv]::Enable("SeRestorePrivilege")'
]

const takeOwnershipPs = (target: string): string[] => [
  ...takeOwnershipPrelude(),
  `$target = ${psq(target)}`,
  'if (-not (Test-Path -LiteralPath $target)) { Log "Path not found, nothing to do: $target" } else {',
  '  $admins = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")',
  '  $items = @(Get-Item -LiteralPath $target -Force) + @(Get-ChildItem -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue)',
  '  $count = 0',
  '  foreach ($i in $items) {',
  '    try {',
  '      $acl = $i.GetAccessControl()',
  '      $acl.SetOwner($admins)',
  '      $i.SetAccessControl($acl)',
  '      $acl = $i.GetAccessControl()',
  '      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($admins, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")',
  '      $acl.AddAccessRule($rule)',
  '      $i.SetAccessControl($acl)',
  '      $count++',
  '    } catch { }',
  '  }',
  '  Log ("Took ownership of " + $count + " items under " + $target)',
  '}'
]

// ---------------------------------------------------------------------------
// Plan builders per mode
// ---------------------------------------------------------------------------

function buildDisableSteps(settings: AppSettings, steps: StepDef[], options: PlanOptions): void {
  if (options.restorePoint) {
    pushStep(
      steps,
      'rp',
      'Create system restore point',
      'Checkpoint-Computer snapshot before any change (skipped with a warning if System Restore is disabled or a point was made in the last 24h).',
      'safe',
      'common',
      restorePointPs()
    )
  }
  pushStep(
    steps,
    'pol',
    'Apply disable policies',
    'Sets DisableAntiSpyware / DisableAntiVirus and real-time protection override policy keys.',
    'moderate',
    'common',
    disablePoliciesPs()
  )
  if (settings.components.telemetry) {
    pushStep(
      steps,
      'spy',
      'Disable Spynet / MAPS telemetry',
      'Stops MAPS membership and automatic sample submission to Microsoft.',
      'safe',
      'telemetry',
      disableSpynetPs()
    )
  }
  if (settings.components.smartScreen) {
    pushStep(
      steps,
      'sms',
      'Disable SmartScreen',
      'Turns off SmartScreen reputation checks via policy.',
      'moderate',
      'smartScreen',
      disableSmartScreenPs()
    )
  }
  pushStep(
    steps,
    'svc',
    'Stop and disable antivirus services',
    'WinDefend and WdNisSvc are stopped and set to Disabled. Blocked by Tamper Protection if enabled.',
    'moderate',
    'services',
    stopAndDisablePs(['WinDefend', 'WdNisSvc'])
  )
  if (settings.components.securityHealth) {
    pushStep(
      steps,
      'shs',
      'Stop and disable Windows Security Health service',
      'SecurityHealthService disabled and the SecurityHealthSystray autostart entry removed.',
      'moderate',
      'securityHealth',
      [
        'sc.exe stop SecurityHealthService | Out-Null',
        'sc.exe config SecurityHealthService start= disabled | Out-Null',
        'Log ("SecurityHealthService exit code: " + $LASTEXITCODE)',
        'Stop-Process -Name SecurityHealthSystray -Force -ErrorAction SilentlyContinue',
        "Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -Name SecurityHealth -ErrorAction SilentlyContinue",
        'Log "Security Health service disabled and tray entry removed."'
      ]
    )
  }
}

function buildEnableSteps(steps: StepDef[]): void {
  pushStep(
    steps,
    'pol',
    'Remove disable policies',
    'Deletes the Windows Defender policy tree and restores SmartScreen defaults.',
    'safe',
    'common',
    [
      "Remove-Item -Path '${POLICY_ROOT}' -Recurse -Force -ErrorAction Stop",
      "Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Name EnableSmartScreen -ErrorAction SilentlyContinue",
      "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer' -Name SmartScreenEnabled -Value 'Warn' -ErrorAction SilentlyContinue",
      'Log "Policy overrides removed."'
    ]
  )
  pushStep(
    steps,
    'svc',
    'Re-enable services',
    'WinDefend -> Automatic, WdNisSvc -> Manual (Demand), SecurityHealthService -> Automatic.',
    'moderate',
    'services',
    [
      'foreach ($pair in @(@("WinDefend","auto"), @("WdNisSvc","demand"), @("SecurityHealthService","auto"))) {',
      '  $n = $pair[0]; $start = $pair[1]',
      '  if (Get-Service -Name $n -ErrorAction SilentlyContinue) {',
      '    sc.exe config $n start= $start | Out-Null',
      '    Log ("Configured " + $n + " -> " + $start + " (exit " + $LASTEXITCODE + ")")',
      '  } else { Log ("Service " + $n + " is missing - was Defender removed? Use Restore instead.") }',
      '}'
    ]
  )
  pushStep(
    steps,
    'run',
    'Restore Security Health tray autostart',
    'Recreates the SecurityHealth Run entry pointing at the existing SecurityHealthSystray.exe.',
    'safe',
    'securityHealth',
    [
      '$tray = Join-Path $env:windir "System32\\SecurityHealthSystray.exe"',
      'if (-not (Test-Path $tray)) { $tray = Join-Path $env:ProgramFiles "Windows Defender\\SecurityHealthSystray.exe" }',
      'if (Test-Path $tray) {',
      "  Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -Name SecurityHealth -Value $tray",
      '  Log "Run entry restored."',
      '} else { Log "SecurityHealthSystray.exe not found on disk." }'
    ]
  )
  pushStep(
    steps,
    'start',
    'Start services',
    'Starts WinDefend and SecurityHealthService immediately.',
    'safe',
    'services',
    [
      "foreach ($n in 'WinDefend','SecurityHealthService') {",
      '  try { Start-Service -Name $n -ErrorAction Stop; Log ("Started " + $n) } catch { Log ("Could not start " + $n + ": " + $_.Exception.Message) }',
      '}'
    ]
  )
}

async function buildRemoveSteps(settings: AppSettings, steps: StepDef[], options: PlanOptions): Promise<void> {
  const c = settings.components

  if (options.restorePoint) {
    pushStep(steps, 'rp', 'Create system restore point', 'Snapshot before destructive changes.', 'safe', 'common', restorePointPs())
  }

  pushStep(
    steps,
    'chk',
    'Report Tamper Protection state',
    'Reads the raw TamperProtection value; if it stays on, later steps fail with access denied.',
    'safe',
    'common',
    [
      "$tp = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows Defender\\Features' -ErrorAction SilentlyContinue).TamperProtection",
      'if ($null -eq $tp) { Log "TamperProtection value not readable (usually means it is ON or Defender already removed)." }',
      'else { Log ("TamperProtection raw value = " + $tp + " (4/5 = ON, 0/1 = OFF)") }'
    ]
  )

  pushStep(steps, 'pol', 'Apply disable policies first', 'Same policy set as Disable mode, as a pre-step.', 'moderate', 'common', disablePoliciesPs())
  if (c.telemetry) pushStep(steps, 'spy', 'Disable Spynet / MAPS telemetry', 'Stops reporting and sample submission.', 'safe', 'telemetry', disableSpynetPs())
  if (c.smartScreen) pushStep(steps, 'sms', 'Disable SmartScreen', 'Turns off SmartScreen via policy.', 'moderate', 'smartScreen', disableSmartScreenPs())
  pushStep(steps, 'svc-stop', 'Stop and disable services', 'Stops everything before deletion.', 'moderate', 'services', stopAndDisablePs(['WinDefend', 'WdNisSvc']))

  let backupDir = ''
  if (options.backup) {
    backupDir = await createBackupDir()
    const svcKeys: Array<[string, string]> = [
      ['HKLM\\SYSTEM\\CurrentControlSet\\Services\\WinDefend', 'svc-WinDefend.reg'],
      ['HKLM\\SYSTEM\\CurrentControlSet\\Services\\WdNisSvc', 'svc-WdNisSvc.reg'],
      ['HKLM\\SYSTEM\\CurrentControlSet\\Services\\WdFilter', 'drv-WdFilter.reg'],
      ['HKLM\\SYSTEM\\CurrentControlSet\\Services\\WdBoot', 'drv-WdBoot.reg'],
      ['HKLM\\SYSTEM\\CurrentControlSet\\Services\\WdNisDrv', 'drv-WdNisDrv.reg'],
      ['HKLM\\SYSTEM\\CurrentControlSet\\Services\\SecurityHealthService', 'svc-SecurityHealthService.reg'],
      ['HKLM\\SOFTWARE\\Microsoft\\Windows Defender', 'sw-WindowsDefender.reg'],
      ['HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender', 'sw-Policies.reg']
    ]
    const regExportLines = svcKeys.map(
      ([key, file]) =>
        `if (Test-Path ('Registry::' + ${psq(key)})) { reg.exe export ${psq(key)} (Join-Path $dir ${psq(file)}) /y | Out-Null; Log ("Exported " + ${psq(key)}) }`
    )
    pushStep(
      steps,
      'bak',
      'Back up services, tasks and registry',
      `Full export to ${backupDir}: service/driver configs as JSON, scheduled tasks as XML, all affected registry keys as .reg files.`,
      'safe',
      'common',
      [
        `$dir = ${psq(backupDir)}`,
        'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
        "$names = 'WinDefend','WdNisSvc','SecurityHealthService','wscsvc','Sense','WdFilter','WdBoot','WdNisDrv'",
        'Get-CimInstance Win32_Service | Where-Object { $names -contains $_.Name } | Select-Object Name,DisplayName,StartMode,State,PathName,StartName,ServiceType,DelayedAutoStart | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $dir "services.json") -Encoding UTF8',
        'Get-CimInstance Win32_SystemDriver | Where-Object { $names -contains $_.Name } | Select-Object Name,DisplayName,StartMode,State,PathName,ServiceType | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $dir "drivers.json") -Encoding UTF8',
        ...regExportLines,
        'Get-ScheduledTask -TaskPath "\\Microsoft\\Windows\\Windows Defender\\" -ErrorAction SilentlyContinue | ForEach-Object {',
        "  $safe = ($_.TaskName -replace '[^A-Za-z0-9._-]', '_')",
        "  Export-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath | Set-Content (Join-Path $dir ('task-' + $safe + '.xml')) -Encoding Unicode",
        '}',
        '@{ createdAt = (Get-Date).ToString("o"); app = "Krestel"; mode = "remove" } | ConvertTo-Json | Set-Content (Join-Path $dir "manifest.json") -Encoding UTF8',
        'Log ("Backup written to " + $dir)'
      ]
    )
  }

  pushStep(
    steps,
    'kill',
    'Stop Defender processes',
    'Force-stops MsMpEng, NisSrv, SecurityHealthService, SecurityHealthSystray and Configuration Wizard (MsMpEngCore).',
    'moderate',
    'common',
    [
      "foreach ($p in 'MsMpEng','NisSrv','SecurityHealthService','SecurityHealthSystray','ConfigSecurityPolicy') {",
      '  Stop-Process -Name $p -Force -ErrorAction SilentlyContinue',
      '}',
      'Start-Sleep -Seconds 2',
      'Log "Defender processes stopped."'
    ]
  )

  if (c.tasks) {
    pushStep(
      steps,
      'tsk',
      'Unregister scheduled tasks',
      'Removes every task under \\Microsoft\\Windows\\Windows Defender\\.',
      'moderate',
      'tasks',
      [
        '$removed = 0',
        'Get-ScheduledTask -TaskPath "\\Microsoft\\Windows\\Windows Defender\\" -ErrorAction SilentlyContinue | ForEach-Object {',
        '  Unregister-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -Confirm:$false -ErrorAction SilentlyContinue',
        '  $removed++',
        '}',
        'Log ("Unregistered " + $removed + " scheduled tasks.")'
      ]
    )
  }

  const delServices: string[] = []
  if (c.services) delServices.push('WinDefend', 'WdNisSvc')
  if (c.securityHealth) delServices.push('SecurityHealthService')
  if (c.atp) delServices.push('Sense')
  if (delServices.length > 0) {
    const list = delServices.map((s) => `'${s}'`).join(', ')
    pushStep(
      steps,
      'sc-del',
      'Delete antivirus services',
      `sc delete: ${delServices.join(', ')}.`,
      'destructive',
      'services',
      [
        `foreach ($s in ${list}) {`,
        '  sc.exe delete $s | Out-Null',
        '  Log ("Deleted service " + $s + " (exit " + $LASTEXITCODE + ")")',
        '}'
      ]
    )
  }

  if (c.drivers) {
    pushStep(
      steps,
      'drv-del',
      'Delete kernel drivers',
      'Deletes WdFilter, WdBoot and WdNisDrv driver services.',
      'destructive',
      'drivers',
      [
        "foreach ($d in 'WdFilter','WdBoot','WdNisDrv') {",
        '  sc.exe stop $d | Out-Null',
        '  sc.exe delete $d | Out-Null',
        '  Log ("Deleted driver " + $d + " (exit " + $LASTEXITCODE + ")")',
        '}'
      ]
    )
    pushStep(
      steps,
      'drv-reg',
      'Delete driver registry keys',
      'Removes leftover driver service keys under HKLM\\SYSTEM\\CurrentControlSet\\Services.',
      'destructive',
      'drivers',
      [
        "foreach ($k in 'WdFilter','WdBoot','WdNisDrv') {",
        "  $p = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\' + $k",
        '  if (Test-Path $p) { Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue; Log ("Deleted key " + $p) }',
        '}'
      ]
    )
  }

  if (c.services) {
    pushStep(
      steps,
      'svc-reg',
      'Delete Defender configuration registry',
      'Removes HKLM\\SOFTWARE\\Microsoft\\Windows Defender and leftover service keys, plus the policy tree.',
      'destructive',
      'services',
      [
        "foreach ($p in 'HKLM:\\SOFTWARE\\Microsoft\\Windows Defender', 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\WinDefend', 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\WdNisSvc') {",
        '  if (Test-Path $p) { Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue; Log ("Deleted key " + $p) }',
        '}',
        "Remove-Item -Path '${POLICY_ROOT}' -Recurse -Force -ErrorAction SilentlyContinue",
        'Log "Defender registry configuration removed."'
      ]
    )
  }

  if (c.filesProgram) {
    pushStep(
      steps,
      'own-pf',
      'Take ownership of program files',
      'Locale-independent ownership/ACL takeover of C:\\Program Files\\Windows Defender (no takeown.exe /d prompt).',
      'destructive',
      'filesProgram',
      takeOwnershipPs('C:\\Program Files\\Windows Defender'),
      900
    )
    pushStep(
      steps,
      'rm-pf',
      'Delete program files',
      'Deletes C:\\Program Files\\Windows Defender recursively.',
      'destructive',
      'filesProgram',
      [
        "$p = 'C:\\Program Files\\Windows Defender'",
        'if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Continue; Log "Program files removed." } else { Log "Already gone." }'
      ],
      900
    )
  }

  if (c.filesData) {
    pushStep(
      steps,
      'own-pd',
      'Take ownership of program data',
      'Ownership/ACL takeover of C:\\ProgramData\\Microsoft\\Windows Defender.',
      'destructive',
      'filesData',
      takeOwnershipPs('C:\\ProgramData\\Microsoft\\Windows Defender'),
      900
    )
    pushStep(
      steps,
      'rm-pd',
      'Delete program data',
      'Deletes C:\\ProgramData\\Microsoft\\Windows Defender (definitions, quarantine, logs).',
      'destructive',
      'filesData',
      [
        "$p = 'C:\\ProgramData\\Microsoft\\Windows Defender'",
        'if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Continue; Log "Program data removed." } else { Log "Already gone." }'
      ],
      900
    )
  }

  if (c.atp) {
    pushStep(
      steps,
      'atp',
      'Remove Defender for Endpoint (ATP)',
      'Deletes Sense service/keys and ATP folders if present.',
      'destructive',
      'atp',
      [
        'sc.exe stop Sense | Out-Null',
        'sc.exe delete Sense | Out-Null',
        "foreach ($p in 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Sense', 'HKLM:\\SOFTWARE\\Microsoft\\Windows Advanced Threat Protection') {",
        '  if (Test-Path $p) { Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue; Log ("Deleted " + $p) }',
        '}',
        "$atpDir = Join-Path $env:ProgramFiles 'Windows Defender Advanced Threat Protection'",
        'if (Test-Path $atpDir) { Remove-Item -LiteralPath $atpDir -Recurse -Force -ErrorAction SilentlyContinue }',
        'Log "ATP removal attempted."'
      ]
    )
  }

  if (c.appx) {
    pushStep(
      steps,
      'appx',
      'Remove Windows Security app package',
      'Remove-AppxPackage for Microsoft.SecHealthUI (all users). May be reinstalled by cumulative updates.',
      'moderate',
      'appx',
      [
        '$pkg = Get-AppxPackage -AllUsers -Name "Microsoft.SecHealthUI" -ErrorAction SilentlyContinue',
        'if ($pkg) {',
        '  try { $pkg | Remove-AppxPackage -AllUsers -ErrorAction Stop; Log "SecHealthUI package removed." }',
        '  catch { $pkg | Remove-AppxPackage -ErrorAction Continue; Log "Removed for current user only (AllUsers failed)." }',
        '} else { Log "SecHealthUI package not installed." }'
      ]
    )
  }

  pushStep(
    steps,
    'done',
    'Finish',
    'Removal complete. A reboot is required for the security center to reflect the change.',
    'safe',
    'common',
    ['Log "Removal finished. Reboot to apply."']
  )
}

function buildRestoreSteps(settings: AppSettings, steps: StepDef[], options: PlanOptions): void {
  const dir = options.backupDir ?? ''
  pushStep(
    steps,
    'pol',
    'Remove disable policies',
    'Deletes policy overrides so Defender can run again.',
    'safe',
    'common',
    [
      "Remove-Item -Path '${POLICY_ROOT}' -Recurse -Force -ErrorAction SilentlyContinue",
      "Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System' -Name EnableSmartScreen -ErrorAction SilentlyContinue",
      "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer' -Name SmartScreenEnabled -Value 'Warn' -ErrorAction SilentlyContinue",
      'Log "Policy overrides removed."'
    ]
  )
  if (dir) {
    pushStep(
      steps,
      'reg',
      'Import registry backups',
      `Imports every .reg file from ${dir}.`,
      'moderate',
      'common',
      [
        `$dir = ${psq(dir)}`,
        '$files = Get-ChildItem -Path $dir -Filter "*.reg" -ErrorAction Stop',
        'foreach ($f in $files) { reg.exe import $f.FullName 2>&1 | Out-Null; Log ("Imported " + $f.Name) }',
        'Log ("Imported " + $files.Count + " registry files.")'
      ]
    )
    pushStep(
      steps,
      'task',
      'Re-register scheduled tasks',
      'Registers every exported task XML back under \\Microsoft\\Windows\\Windows Defender\\.',
      'moderate',
      'tasks',
      [
        `$dir = ${psq(dir)}`,
        '$count = 0',
        'Get-ChildItem -Path $dir -Filter "task-*.xml" -ErrorAction SilentlyContinue | ForEach-Object {',
        '  $taskName = $_.BaseName.Substring(5)',
        '  try {',
        '    Register-ScheduledTask -TaskPath "\\Microsoft\\Windows\\Windows Defender\\" -TaskName $taskName -Xml (Get-Content -LiteralPath $_.FullName -Raw) -Force -ErrorAction Stop | Out-Null',
        '    $count++',
        '  } catch { Log ("Could not register task " + $taskName + ": " + $_.Exception.Message) }',
        '}',
        'Log ("Registered " + $count + " tasks.")'
      ]
    )
    pushStep(
      steps,
      'svc',
      'Recreate missing services',
      'Uses services.json / drivers.json manifests to sc-create anything the registry import did not restore.',
      'moderate',
      'services',
      [
        `$dir = ${psq(dir)}`,
        'foreach ($json in "services.json","drivers.json") {',
        '  $path = Join-Path $dir $json',
        '  if (-not (Test-Path $path)) { continue }',
        '  $items = @(Get-Content $path -Raw | ConvertFrom-Json)',
        '  foreach ($s in $items) {',
        '    if (Get-Service -Name $s.Name -ErrorAction SilentlyContinue) { continue }',
        '    if (-not $s.PathName) { continue }',
        '    Log ("Recreating service " + $s.Name)',
        '    sc.exe create $s.Name binpath= $s.PathName start= demand | Out-Null',
        '    if ($s.DisplayName) { sc.exe config $s.Name displayname= $s.DisplayName | Out-Null }',
        '  }',
        '}'
      ]
    )
  }
  pushStep(
    steps,
    'svc2',
    'Reset service startup types',
    'WinDefend -> Automatic, WdNisSvc -> Manual, SecurityHealthService -> Automatic.',
    'moderate',
    'services',
    [
      'foreach ($pair in @(@("WinDefend","auto"), @("WdNisSvc","demand"), @("SecurityHealthService","auto"))) {',
      '  $n = $pair[0]',
      '  if (Get-Service -Name $n -ErrorAction SilentlyContinue) { sc.exe config $n start= $pair[1] | Out-Null; Log ("Set " + $n + " startup (exit " + $LASTEXITCODE + ")") }',
      '  else { Log ("Service " + $n + " missing - files may need a DISM repair.") }',
      '}'
    ]
  )
  pushStep(
    steps,
    'appx',
    'Re-register Windows Security app',
    'Registers SecHealthUI from C:\\Windows\\SystemApps if it is not installed.',
    'moderate',
    'appx',
    [
      'if (-not (Get-AppxPackage -AllUsers -Name "Microsoft.SecHealthUI" -ErrorAction SilentlyContinue)) {',
      '  $pkg = Get-ChildItem "C:\\Windows\\SystemApps" -Directory -Filter "Microsoft.Windows.SecHealthUI*" -ErrorAction SilentlyContinue | Select-Object -First 1',
      '  if ($pkg) {',
      '    $manifest = Join-Path $pkg.FullName "AppXManifest.xml"',
      '    try { Add-AppxPackage -DisableDevelopmentMode -Register $manifest -AllUsers -ErrorAction Stop; Log "SecHealthUI re-registered (all users)." }',
      '    catch { Add-AppxPackage -DisableDevelopmentMode -Register $manifest -ErrorAction Continue; Log "SecHealthUI re-registered (current user)." }',
      '  } else { Log "SecHealthUI provisioning folder not found." }',
      '} else { Log "SecHealthUI already installed." }'
    ]
  )
  pushStep(
    steps,
    'run',
    'Restore Security Health tray autostart',
    'Recreates the SecurityHealth Run entry.',
    'safe',
    'securityHealth',
    [
      '$tray = Join-Path $env:windir "System32\\SecurityHealthSystray.exe"',
      'if (-not (Test-Path $tray)) { $tray = Join-Path $env:ProgramFiles "Windows Defender\\SecurityHealthSystray.exe" }',
      'if (Test-Path $tray) { Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" -Name SecurityHealth -Value $tray; Log "Run entry restored." }',
      'else { Log "SecurityHealthSystray.exe not found." }'
    ]
  )
  pushStep(
    steps,
    'start',
    'Start services',
    'Starts WinDefend and SecurityHealthService.',
    'safe',
    'services',
    [
      "foreach ($n in 'WinDefend','SecurityHealthService') {",
      '  try { Start-Service -Name $n -ErrorAction Stop; Log ("Started " + $n) } catch { Log ("Could not start " + $n + ": " + $_.Exception.Message) }',
      '}'
    ]
  )
  if (options.repairSystem) {
    pushStep(
      steps,
      'sfc',
      'System file check (sfc /scannow)',
      'Verifies and repairs protected Windows files including Defender binaries. Can take 10+ minutes.',
      'moderate',
      'common',
      ['sfc.exe /scannow', 'Log ("sfc exit code: " + $LASTEXITCODE)'],
      3600
    )
    pushStep(
      steps,
      'dism',
      'Component store repair (DISM)',
      'DISM /Online /Cleanup-Image /RestoreHealth - re-downloads corrupted components, including Defender platform files.',
      'moderate',
      'common',
      ['DISM.exe /Online /Cleanup-Image /RestoreHealth', 'Log ("DISM exit code: " + $LASTEXITCODE)'],
      3600
    )
  }
  pushStep(
    steps,
    'done',
    'Finish',
    'Restore complete. Reboot, then check Windows Security. If files were deleted without a backup, an in-place upgrade repair may be needed.',
    'safe',
    'common',
    ['Log "Restore finished. Reboot recommended."']
  )
}

const MODE_SUMMARY: Record<ActionMode, string> = {
  disable: 'Disables real-time protection, services and telemetry via policy - fully reversible with Enable.',
  enable: 'Removes policy overrides, re-enables and starts Defender services.',
  remove: 'Permanently removes the selected Defender components. A backup is written first when enabled.',
  restore: 'Restores Defender from a backup (registry, tasks, services) and re-enables protection.'
}

export async function buildExecutablePlan(
  settings: AppSettings,
  mode: ActionMode,
  override: Partial<PlanOptions> = {}
): Promise<ExecutablePlan> {
  const options: PlanOptions = {
    restorePoint: settings.options.restorePoint,
    backup: settings.options.backup,
    dryRun: false,
    repairSystem: settings.options.repairSystem,
    ...override
  }
  const steps: StepDef[] = []
  if (mode === 'disable') buildDisableSteps(settings, steps, options)
  else if (mode === 'enable') buildEnableSteps(steps)
  else if (mode === 'remove') await buildRemoveSteps(settings, steps, options)
  else buildRestoreSteps(settings, steps, options)

  const plan: Plan = {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode,
    createdAt: Date.now(),
    requiresReboot: mode === 'remove' || mode === 'restore',
    summary: MODE_SUMMARY[mode],
    steps: steps.map(({ id, title, detail, risk, group }) => ({ id, title, detail, risk, group })),
    options
  }
  return { plan, steps }
}

export { backupsRoot }
