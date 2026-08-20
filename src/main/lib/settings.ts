import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AppSettings, ComponentId } from '../../shared/types'

const DEFAULT_COMPONENTS: Record<ComponentId, boolean> = {
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  components: DEFAULT_COMPONENTS,
  options: {
    restorePoint: true,
    backup: true,
    repairSystem: false
  }
}

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsFile(), 'utf8')) as Partial<AppSettings>
    return {
      components: { ...DEFAULT_COMPONENTS, ...(raw.components ?? {}) },
      options: { ...DEFAULT_SETTINGS.options, ...(raw.options ?? {}) }
    }
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf8')
}
