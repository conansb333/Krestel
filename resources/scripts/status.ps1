# Krestel - read-only system status probe.
# Emits a single '##JSON::<json>' line on stdout. Every section is fault-isolated
# so the probe still works when Defender is disabled or removed.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function SafeScript([scriptblock]$b) {
    try { & $b } catch { $null }
}

$os = SafeScript { Get-CimInstance Win32_OperatingSystem }
$build = [int]($os.BuildNumber)
$isWin11 = $build -ge 22000
$supported = ($build -ge 10240)

# --- Defender services -------------------------------------------------------
$svcNames = @('WinDefend', 'WdNisSvc', 'SecurityHealthService', 'wscsvc', 'Sense')
$services = @()
foreach ($n in $svcNames) {
    $s = SafeScript { Get-CimInstance Win32_Service -Filter "Name='$n'" }
    if ($s) {
        $services += [ordered]@{
            name = $n; displayName = [string]$s.DisplayName; state = [string]$s.State
            startMode = [string]$s.StartMode; exists = $true
        }
    } else {
        $services += @{ name = $n; displayName = $n; state = 'NotFound'; startMode = 'NotFound'; exists = $false }
    }
}

# --- Defender kernel drivers -------------------------------------------------
$drvNames = @('WdFilter', 'WdBoot', 'WdNisDrv')
$drivers = @()
foreach ($n in $drvNames) {
    $d = SafeScript { Get-CimInstance Win32_SystemDriver -Filter "Name='$n'" }
    if ($d) {
        $drivers += [ordered]@{
            name = $n; displayName = [string]$d.DisplayName; state = [string]$d.State
            startMode = [string]$d.StartMode; exists = $true
        }
    } else {
        $drivers += @{ name = $n; displayName = $n; state = 'NotFound'; startMode = 'NotFound'; exists = $false }
    }
}

# --- Defender engine status (Get-MpComputerStatus) ---------------------------
$mp = SafeScript { Get-MpComputerStatus }
$antivirusEnabled = $null; $realtimeEnabled = $null; $amRunningMode = $null
$engineVersion = $null; $sigVersion = $null; $sigAge = $null; $tamper = 'unknown'
if ($mp) {
    $antivirusEnabled = [bool]$mp.AntivirusEnabled
    $realtimeEnabled = [bool]$mp.RealTimeProtectionEnabled
    $amRunningMode = [string]$mp.AMRunningMode
    $engineVersion = [string]$mp.AMEngineVersion
    $sigVersion = [string]$mp.AntivirusSignatureVersion
    $sigAge = $null; if ($mp.AntivirusSignatureAge -ne $null) { $sigAge = [int]$mp.AntivirusSignatureAge }
}

# Tamper protection: value only readable when TP is off; 4/5 = on, 0/1 = off.
$tpReg = SafeScript { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Defender\Features' -Name TamperProtection).TamperProtection }
if ($tpReg -ne $null) {
    if ($tpReg -ge 4) { $tamper = 'on' } else { $tamper = 'off' }
} elseif ($mp -and $mp.RealTimeProtectionEnabled) {
    $tamper = 'on'
}

# --- Policy keys --------------------------------------------------------------
function GetDword($path, $name) {
    $v = SafeScript { (Get-ItemProperty -Path $path -Name $name -ErrorAction Stop).$name }
    if ($v -ne $null) { return [int]$v }
    return 0
}
$polRoot = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender'
$policies = [ordered]@{
    disableAntiSpyware = (GetDword $polRoot 'DisableAntiSpyware') -eq 1
    disableAntiVirus   = (GetDword $polRoot 'DisableAntiVirus') -eq 1
    realtimeDisabled   = (GetDword "$polRoot\Real-Time Protection" 'DisableRealtimeMonitoring') -eq 1
    spynetDisabled     = (GetDword "$polRoot\Spynet" 'SpynetReporting') -eq 0
    smartScreenDisabled = ((GetDword 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\System' 'EnableSmartScreen') -eq 0)
}

# --- Scheduled tasks ----------------------------------------------------------
$tasks = @()
$tsk = SafeScript { Get-ScheduledTask -TaskPath '\Microsoft\Windows\Windows Defender\' }
foreach ($t in $tsk) { $tasks += @{ name = [string]$t.TaskName; state = [string]$t.State } }

# --- Windows Security app package ---------------------------------------------
$appxPkg = SafeScript { Get-AppxPackage -Name 'Microsoft.SecHealthUI' -AllUsers }
$appxInstalled = [bool]$appxPkg
$appxVersion = $null; if ($appxPkg) { $appxVersion = [string]$appxPkg.Version }

# --- Third-party antivirus (Security Center) ----------------------------------
$avProducts = @()
$wmiAV = SafeScript { Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntiVirusProduct }
foreach ($p in $wmiAV) {
    $name = [string]$p.displayName
    if ($name -match 'Windows Defender|Microsoft Defender') { continue }
    $state = [int]$p.productState
    $hex = ('{0:X6}' -f $state)
    $enabled = ($hex.Length -ge 4 -and $hex.Substring($hex.Length - 4, 2) -eq '10')
    $upToDate = $null
    if ($hex.Length -ge 2) { $upToDate = ($hex.Substring($hex.Length - 2, 2) -eq '00') }
    $avProducts += @{ name = $name; enabled = [bool]$enabled; upToDate = $upToDate }
}

# --- Filesystem presence --------------------------------------------------------
$installed =
    (Test-Path 'C:\Program Files\Windows Defender\MsMpEng.exe') -or
    (Test-Path "$env:ProgramData\Microsoft\Windows Defender\Platform") -or
    [bool]($services | Where-Object { $_.name -eq 'WinDefend' -and $_.exists })

# --- Warnings -------------------------------------------------------------------
$warnings = @()
if (-not $supported) { $warnings += 'This Windows build is not fully supported. Tools target Windows 10 (build 10240+) and Windows 11.' }
if ($tamper -eq 'on' -or $tamper -eq 'unknown') {
    $warnings += 'Tamper Protection appears to be ON (or unknown). Most changes will be blocked until you disable it in Windows Security > Virus & threat protection > Manage settings.'
}
$activeThird = @($avProducts | Where-Object { $_.enabled })
if ($activeThird.Count -eq 0 -and $realtimeEnabled -eq $false) {
    $warnings += 'No third-party antivirus is registered. After disabling/removing Defender this machine will have no real-time protection.'
}
if (-not $appxInstalled -and ($services | Where-Object { $_.name -eq 'WinDefend' -and $_.exists })) {
    $warnings += 'Windows Security app package is missing while the antivirus service still exists.'
}

$out = [ordered]@{
    ok = $true
    os = @{
        caption = [string]$os.Caption
        version = [string]$os.Version
        build = $build
        arch = [string]$env:PROCESSOR_ARCHITECTURE
        isWin11 = $isWin11
        supported = [bool]$supported
        psVersion = [string]$PSVersionTable.PSVersion
    }
    defender = @{
        installed = [bool]$installed
        antivirusEnabled = $antivirusEnabled
        realtimeEnabled = $realtimeEnabled
        tamperProtection = $tamper
        amRunningMode = $amRunningMode
        engineVersion = $engineVersion
        signatureVersion = $sigVersion
        signatureAge = $sigAge
    }
    policies = $policies
    services = $services
    drivers = $drivers
    tasks = $tasks
    appxInstalled = $appxInstalled
    appxVersion = $appxVersion
    thirdPartyAV = $avProducts
    warnings = $warnings
}

Write-Output ('##JSON::' + ($out | ConvertTo-Json -Depth 6 -Compress))
