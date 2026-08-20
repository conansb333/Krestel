import { spawn } from 'node:child_process'

export interface PsResult {
  code: number
  stdout: string
  stderr: string
}

/** One-shot PowerShell invocation. `onLine` receives each stdout line as it arrives. */
export function runPowerShell(args: string[], onLine?: (line: string) => void): Promise<PsResult> {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], {
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let outBuf = ''
    let errBuf = ''

    child.stdout.on('data', (chunk: Buffer) => {
      outBuf += chunk.toString('utf8')
      const lines = outBuf.split(/\r?\n/)
      outBuf = lines.pop() ?? ''
      for (const line of lines) {
        stdout += line + '\n'
        onLine?.(line)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      errBuf += chunk.toString('utf8')
      const lines = errBuf.split(/\r?\n/)
      errBuf = lines.pop() ?? ''
      for (const line of lines) stderr += line + '\n'
    })
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + String(err) })
    })
    child.on('close', (code) => {
      if (outBuf) {
        stdout += outBuf + '\n'
        onLine?.(outBuf)
      }
      if (errBuf) stderr += errBuf + '\n'
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** Quote a string safely for embedding into a PowerShell snippet. */
export function psq(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Locate the bundled resources dir (dev vs packaged). */
export function resourcesPath(...segments: string[]): string {
  const { app } = require('electron') as typeof import('electron')
  const base = app.isPackaged
    ? require('node:path').join(process.resourcesPath, 'resources')
    : require('node:path').join(app.getAppPath(), 'resources')
  return require('node:path').join(base, ...segments)
}
