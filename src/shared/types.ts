export type ActionMode = 'disable' | 'enable' | 'remove' | 'restore'

export type RiskLevel = 'safe' | 'moderate' | 'destructive'

export type ComponentId =
  | 'services'
  | 'securityHealth'
  | 'drivers'
  | 'tasks'
  | 'appx'
  | 'filesProgram'
  | 'filesData'
  | 'atp'
  | 'telemetry'
  | 'smartScreen'

export type StepGroup = ComponentId | 'common'

export interface PlanOptions {
  restorePoint: boolean
  backup: boolean
  dryRun: boolean
  repairSystem: boolean
  backupDir?: string
}

export interface PlanStep {
  id: string
  title: string
  detail: string
  risk: RiskLevel
  group: StepGroup
}

export interface Plan {
  id: string
  mode: ActionMode
  createdAt: number
  requiresReboot: boolean
  summary: string
  steps: PlanStep[]
  options: PlanOptions
}

export type RunEventType =
  | 'run-start'
  | 'step-start'
  | 'log'
  | 'step-done'
  | 'step-error'
  | 'run-done'
  | 'run-cancelled'
  | 'run-error'

export interface RunEvent {
  type: RunEventType
  planId: string
  stepId?: string
  message?: string
  ts: number
}

export interface ServiceInfo {
  name: string
  displayName: string
  state: string
  startMode: string
  exists: boolean
}

export interface TaskInfo {
  name: string
  state: string
}

export interface AVProductInfo {
  name: string
  enabled: boolean
  upToDate: boolean | null
}

export interface DefenderStatus {
  ok: boolean
  queryError?: string
  os: {
    caption: string
    version: string
    build: number
    arch: string
    isWin11: boolean
    supported: boolean
    psVersion: string
  }
  defender: {
    installed: boolean
    antivirusEnabled: boolean | null
    realtimeEnabled: boolean | null
    tamperProtection: string
    amRunningMode: string | null
    engineVersion: string | null
    signatureVersion: string | null
    signatureAge: number | null
  }
  policies: {
    disableAntiSpyware: boolean
    disableAntiVirus: boolean
    realtimeDisabled: boolean
    spynetDisabled: boolean
    smartScreenDisabled: boolean
  }
  services: ServiceInfo[]
  drivers: ServiceInfo[]
  tasks: TaskInfo[]
  appxInstalled: boolean
  appxVersion: string | null
  thirdPartyAV: AVProductInfo[]
  warnings: string[]
}

export interface AppSettings {
  components: Record<ComponentId, boolean>
  options: Omit<PlanOptions, 'backupDir' | 'dryRun'>
}

export interface BackupInfo {
  dir: string
  name: string
  createdAt: number
  manifest: { createdAt: string; mode: string; components: string[] } | null
  fileCount: number
  sizeBytes: number
}

export const DEFENDER_SERVICES = ['WinDefend', 'WdNisSvc', 'SecurityHealthService'] as const
export const DEFENDER_DRIVERS = ['WdNisDrv', 'WdBoot', 'WdFilter'] as const

export const COMPONENT_META: Record<
  ComponentId,
  { label: string; description: string; risk: RiskLevel; removeOnly?: boolean }
> = {
  services: {
    label: 'Antivirus services',
    description:
      'WinDefend (Antivirus) and WdNisSvc (Network Inspection). Disabling stops real-time scanning; removing deletes the services.',
    risk: 'destructive'
  },
  securityHealth: {
    label: 'Windows Security Health service',
    description:
      'SecurityHealthService and the SecurityHealthSystray tray icon that hosts the Windows Security UI.',
    risk: 'moderate'
  },
  drivers: {
    label: 'Kernel drivers',
    description: 'WdFilter, WdBoot and WdNisDrv kernel drivers used for on-access scanning.',
    risk: 'destructive'
  },
  tasks: {
    label: 'Scheduled tasks',
    description: 'All tasks under \\Microsoft\\Windows\\Windows Defender (scheduled scans, cache maintenance...).',
    risk: 'moderate'
  },
  appx: {
    label: 'Windows Security app (SecHealthUI)',
    description: 'The UWP Windows Security / Windows Defender app package shown in Settings.',
    risk: 'moderate'
  },
  filesProgram: {
    label: 'Program files',
    description: 'C:\\Program Files\\Windows Defender (engine binaries, platform, ASAM signatures).',
    risk: 'destructive'
  },
  filesData: {
    label: 'Program data',
    description: 'C:\\ProgramData\\Microsoft\\Windows Defender (definitions, quarantined items, logs).',
    risk: 'destructive'
  },
  atp: {
    label: 'Defender for Endpoint (ATP)',
    description: 'Advanced Threat Protection service, drivers and files, if installed (enterprise environments).',
    risk: 'destructive'
  },
  telemetry: {
    label: 'Spynet telemetry',
    description: 'MAPS membership and sample submission (SpyNet reporting). Disabling stops sending data to Microsoft.',
    risk: 'safe',
    removeOnly: false
  },
  smartScreen: {
    label: 'SmartScreen',
    description: 'Windows SmartScreen reputation checks for apps and files (Explorer + Edge legacy).',
    risk: 'moderate',
    removeOnly: false
  }
}
