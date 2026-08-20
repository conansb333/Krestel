import type { DefenderStatus } from '../../shared/types'
import { resourcesPath, runPowerShell } from './ps'

export async function getStatus(): Promise<DefenderStatus> {
  const script = resourcesPath('scripts', 'status.ps1')
  const result = await runPowerShell(['-File', script])
  const jsonLine = result.stdout.split(/\r?\n/).find((l) => l.startsWith('##JSON::'))
  if (!jsonLine) {
    return {
      ok: false,
      queryError: (result.stderr || 'status query returned no data').split(/\r?\n/)[0] ?? 'unknown error',
      os: {
        caption: 'Unknown',
        version: '',
        build: 0,
        arch: '',
        isWin11: false,
        supported: false,
        psVersion: ''
      },
      defender: {
        installed: false,
        antivirusEnabled: null,
        realtimeEnabled: null,
        tamperProtection: 'unknown',
        amRunningMode: null,
        engineVersion: null,
        signatureVersion: null,
        signatureAge: null
      },
      policies: {
        disableAntiSpyware: false,
        disableAntiVirus: false,
        realtimeDisabled: false,
        spynetDisabled: false,
        smartScreenDisabled: false
      },
      services: [],
      drivers: [],
      tasks: [],
      appxInstalled: false,
      appxVersion: null,
      thirdPartyAV: [],
      warnings: ['Status query failed.']
    }
  }
  try {
    return JSON.parse(jsonLine.slice('##JSON::'.length)) as DefenderStatus
  } catch (err) {
    return {
      ok: false,
      queryError: `failed to parse status output: ${String(err)}`,
      os: {
        caption: 'Unknown',
        version: '',
        build: 0,
        arch: '',
        isWin11: false,
        supported: false,
        psVersion: ''
      },
      defender: {
        installed: false,
        antivirusEnabled: null,
        realtimeEnabled: null,
        tamperProtection: 'unknown',
        amRunningMode: null,
        engineVersion: null,
        signatureVersion: null,
        signatureAge: null
      },
      policies: {
        disableAntiSpyware: false,
        disableAntiVirus: false,
        realtimeDisabled: false,
        spynetDisabled: false,
        smartScreenDisabled: false
      },
      services: [],
      drivers: [],
      tasks: [],
      appxInstalled: false,
      appxVersion: null,
      thirdPartyAV: [],
      warnings: ['Status query failed.']
    }
  }
}
