import type {
  ActionMode,
  AppSettings,
  BackupInfo,
  DefenderStatus,
  Plan,
  PlanOptions,
  RunEvent
} from '@shared/types'
import type { KrestelApi } from '@shared/api'

// ---------------------------------------------------------------------------
// Mock backend used when the renderer runs in a plain browser (no Electron).
// Lets the whole UI be developed/previewed without touching a real system.
// ---------------------------------------------------------------------------

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const MOCK_STATUS: DefenderStatus = {
  ok: true,
  os: {
    caption: 'Windows 11 Pro',
    version: '10.0.26100',
    build: 26100,
    arch: 'AMD64',
    isWin11: true,
    supported: true,
    psVersion: '5.1.26100.2894'
  },
  defender: {
    installed: true,
    antivirusEnabled: true,
    realtimeEnabled: true,
    tamperProtection: 'on',
    amRunningMode: 'Normal',
    engineVersion: '1.1.25080.5',
    signatureVersion: '1.421.1763.0',
    signatureAge: 0
  },
  policies: {
    disableAntiSpyware: false,
    disableAntiVirus: false,
    realtimeDisabled: false,
    spynetDisabled: false,
    smartScreenDisabled: false
  },
  services: [
    { name: 'WinDefend', displayName: 'Microsoft Defender Antivirus Service', state: 'Running', startMode: 'Auto', exists: true },
    { name: 'WdNisSvc', displayName: 'Microsoft Defender Network Inspection Service', state: 'Running', startMode: 'Manual', exists: true },
    { name: 'SecurityHealthService', displayName: 'Windows Security Service', state: 'Running', startMode: 'Auto', exists: true },
    { name: 'wscsvc', displayName: 'Security Center', state: 'Running', startMode: 'Delayed Auto', exists: true },
    { name: 'Sense', displayName: 'Windows Defender Advanced Threat Protection Service', state: 'NotFound', startMode: 'NotFound', exists: false }
  ],
  drivers: [
    { name: 'WdFilter', displayName: 'Microsoft Defender antimalware mini-filter', state: 'Running', startMode: 'System', exists: true },
    { name: 'WdBoot', displayName: 'Microsoft antimalware boot driver', state: 'Running', startMode: 'System', exists: true },
    { name: 'WdNisDrv', displayName: 'Microsoft network inspection system driver', state: 'Running', startMode: 'Manual', exists: true }
  ],
  tasks: [
    { name: 'Cache Maintenance', state: 'Ready' },
    { name: 'Cleanup', state: 'Ready' },
    { name: 'Scheduled Scan', state: 'Ready' },
    { name: 'Verification', state: 'Ready' },
    { name: 'Windows Defender Cache Maintenance', state: 'Ready' }
  ],
  appxInstalled: true,
  appxVersion: '1000.26100.3.3',
  thirdPartyAV: [],
  warnings: [
    'Tamper Protection appears to be ON (or unknown). Most changes will be blocked until you disable it in Windows Security > Virus & threat protection > Manage settings.',
    'No third-party antivirus is registered. After disabling/removing Defender this machine will have no real-time protection.'
  ]
}

const MOCK_SETTINGS: AppSettings = {
  components: {
    services: true,
    securityHealth: true,
    drivers: true,
    tasks: true,
    appx: true,
    filesProgram: true,
    filesData: true,
    atp: false,
    telemetry: true,
    smartScreen: false
  },
  options: { restorePoint: true, backup: true, repairSystem: false }
}

const MOCK_BACKUPS: BackupInfo[] = [
  {
    dir: 'backup-20260818-142233',
    name: 'backup-20260818-142233',
    createdAt: Date.parse('2026-08-18T14:22:33Z'),
    manifest: { createdAt: '2026-08-18T14:22:33Z', mode: 'remove', components: ['services', 'drivers', 'tasks'] },
    fileCount: 14,
    sizeBytes: 4_812_339
  },
  {
    dir: 'backup-20260702-091045',
    name: 'backup-20260702-091045',
    createdAt: Date.parse('2026-07-02T09:10:45Z'),
    manifest: { createdAt: '2026-07-02T09:10:45Z', mode: 'remove', components: ['appx'] },
    fileCount: 6,
    sizeBytes: 1_204_004
  }
]

function mockPlan(mode: ActionMode, override?: Partial<PlanOptions>): Plan {
  const stepCount = mode === 'remove' ? 14 : mode === 'restore' ? 8 : mode === 'disable' ? 6 : mode === 'backup' ? 1 : 4
  const titles: Record<ActionMode, string[]> = {
    disable: ['Create system restore point', 'Apply disable policies', 'Disable Spynet / MAPS telemetry', 'Stop and disable antivirus services', 'Stop and disable Windows Security Health service', 'Finish'],
    enable: ['Remove disable policies', 'Re-enable services', 'Restore Security Health tray autostart', 'Start services'],
    remove: [
      'Create system restore point', 'Report Tamper Protection state', 'Apply disable policies first',
      'Disable Spynet / MAPS telemetry', 'Stop and disable services', 'Back up services, tasks and registry',
      'Stop Defender processes', 'Unregister scheduled tasks', 'Delete antivirus services',
      'Delete kernel drivers', 'Delete driver registry keys', 'Delete Defender configuration registry',
      'Take ownership of program files', 'Delete program files'
    ],
    restore: ['Remove disable policies', 'Import registry backups', 'Re-register scheduled tasks', 'Recreate missing services', 'Reset service startup types', 'Re-register Windows Security app', 'Restore Security Health tray autostart', 'Start services'],
    backup: ['Back up services, tasks and registry']
  }
  return {
    id: `mock-${Date.now()}`,
    mode,
    createdAt: Date.now(),
    requiresReboot: mode === 'remove' || mode === 'restore',
    summary: {
      disable: 'Disables real-time protection, services and telemetry via policy - fully reversible with Enable.',
      enable: 'Removes policy overrides, re-enables and starts Defender services.',
      remove: 'Permanently removes the selected Defender components. A backup is written first when enabled.',
      restore: 'Restores Defender from a backup (registry, tasks, services) and re-enables protection.',
      backup: 'Creates a full backup right now: registry exports, service/driver manifests and scheduled task XML. Nothing on the system is changed.'
    }[mode],
    steps: titles[mode].slice(0, stepCount).map((title, i) => ({
      id: `s${i}`,
      title,
      detail: 'Demo-mode step - in the desktop app this describes the exact commands to run.',
      risk: mode === 'remove' && i >= 7 ? 'destructive' : i === 0 || mode === 'backup' ? 'safe' : 'moderate',
      group: 'common'
    })),
    options: { restorePoint: true, backup: true, dryRun: override?.dryRun ?? false, repairSystem: false, ...override }
  }
}

function createMockApi(): KrestelApi {
  let settings = structuredClone(MOCK_SETTINGS)
  const listeners = new Set<(e: RunEvent) => void>()
  let running = false
  let cancelled = false
  let lastMode: ActionMode = 'disable'

  const emit = (e: RunEvent): void => listeners.forEach((l) => l(e))

  return {
    platform: 'electron',
    appVersion: async () => '1.1.2 (demo)',
    isAdmin: async () => true,
    relaunchElevated: async () => true,
    getStatus: async () => {
      await delay(450)
      return structuredClone(MOCK_STATUS)
    },
    getSettings: async () => structuredClone(settings),
    saveSettings: async (s) => {
      settings = structuredClone(s)
    },
    buildPlan: async (mode, override) => {
      await delay(250)
      lastMode = mode
      return mockPlan(mode, override)
    },
    runPlan: async (planId) => {
      if (running) return { started: false, error: 'Another action is already running.' }
      running = true
      cancelled = false
      emit({ type: 'run-start', planId, ts: Date.now() })
      void (async () => {
        const plan = mockPlan(lastMode)
        for (const step of plan.steps) {
          if (cancelled) break
          emit({ type: 'step-start', planId, stepId: step.id, ts: Date.now() })
          await delay(500)
          emit({ type: 'log', planId, message: `[demo] ${step.title} executed successfully`, ts: Date.now() })
          emit({ type: 'step-done', planId, stepId: step.id, ts: Date.now() })
        }
        emit({ type: cancelled ? 'run-cancelled' : 'run-done', planId, ts: Date.now() })
        running = false
      })()
      return { started: true }
    },
    cancelRun: () => {
      cancelled = true
    },
    onRunEvent: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    listBackups: async () => structuredClone(MOCK_BACKUPS),
    deleteBackup: async (name) => name.length > 0,
    openBackupsFolder: async () => undefined,
    exportLogs: async () => ({ saved: true, path: 'C:\\Users\\demo\\Documents\\log.txt' }),
    openExternal: async () => undefined
  }
}

const electronApi = typeof window !== 'undefined' ? window.krestel : undefined

export const api: KrestelApi = electronApi ?? createMockApi()
export const isDemoMode: boolean = electronApi === undefined
