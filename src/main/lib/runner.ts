import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { RunEventType } from '../../shared/types'
import type { ExecutablePlan, StepDef } from './plans'

export type EmitFn = (type: RunEventType, stepId?: string, message?: string) => void

class ActiveRun {
  child: ChildProcess | null = null
  cancelled = false
  stepTimer: NodeJS.Timeout | null = null
  currentStep: StepDef | null = null
  sawEnd = false
}

let active: ActiveRun | null = null

export function isRunning(): boolean {
  return active !== null
}

export function cancelRun(): boolean {
  if (!active) return false
  active.cancelled = true
  if (active.stepTimer) clearTimeout(active.stepTimer)
  active.child?.kill()
  return true
}

function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}

function drySummary(ps: string[]): string {
  const first = ps
    .filter((l) => !l.trimStart().startsWith('#') && l.trim() !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 180)
  return first
}

export function buildScript(ex: ExecutablePlan): string {
  const dry = ex.plan.options.dryRun ? 1 : 0
  const lines: string[] = [
    '$ErrorActionPreference = "Continue"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'function Log([string]$m) { if ($m) { Write-Output ("##LOG::" + ($m -replace "\\r?\\n", " | ")) } }',
    'function StepFail([string]$i, [string]$m) { Write-Output ("##FAIL::" + $i + "::" + (([string]$m) -replace "\\r?\\n", " | ")) }',
    `$DRYRUN = ${dry}`
  ]
  for (const step of ex.steps) {
    const id = psQuote(step.id)
    lines.push(`Write-Output ("##STEP::" + ${id})`)
    lines.push('if ($DRYRUN -eq 1) {')
    lines.push(`  Log ("DRY RUN, skipping: " + ${psQuote(drySummary(step.ps))})`)
    lines.push(`  Write-Output ("##DONE::" + ${id})`)
    lines.push('} else {')
    // NOTE: step lines must stay at column 0 - PowerShell here-string terminators
    // ("'@") are not allowed to be indented.
    lines.push('  try {')
    for (const psLine of step.ps) lines.push(psLine)
    lines.push(`    Write-Output ("##DONE::" + ${id})`)
    lines.push('  } catch {')
    lines.push(`    StepFail ${id} ([string]$_.Exception.Message)`)
    lines.push('  }')
    lines.push('}')
  }
  lines.push('Write-Output "##END::ok"')
  return lines.join('\r\n')
}

async function execute(ex: ExecutablePlan, emit: EmitFn): Promise<void> {
  const run = new ActiveRun()
  active = run
  const scriptPath = path.join(app.getPath('temp'), `krestel-plan-${ex.plan.id}.ps1`)
  const script = '\ufeff' + buildScript(ex)

  const finish = (type: RunEventType, message?: string) => {
    if (run.stepTimer) clearTimeout(run.stepTimer)
    active = null
    emit(type, undefined, message)
    fs.rm(scriptPath, { force: true }).catch(() => undefined)
  }

  try {
    await fs.writeFile(scriptPath, script, 'utf8')
  } catch (err) {
    finish('run-error', `could not write script: ${String(err)}`)
    return
  }

  emit('run-start')

  const armStepTimeout = (step: StepDef): void => {
    if (run.stepTimer) clearTimeout(run.stepTimer)
    run.currentStep = step
    run.stepTimer = setTimeout(() => {
      run.cancelled = true
      run.child?.kill()
      finish('run-error', `step "${step.title}" timed out after ${step.timeoutSec}s`)
    }, step.timeoutSec * 1000)
  }

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { windowsHide: true }
  )
  run.child = child

  const handleLine = (line: string): void => {
    if (!line) return
    if (line.startsWith('##STEP::')) {
      const id = line.slice(8)
      const step = ex.steps.find((s) => s.id === id)
      emit('step-start', id)
      if (step) armStepTimeout(step)
      return
    }
    if (line.startsWith('##DONE::')) {
      if (run.stepTimer) clearTimeout(run.stepTimer)
      emit('step-done', line.slice(8))
      return
    }
    if (line.startsWith('##FAIL::')) {
      if (run.stepTimer) clearTimeout(run.stepTimer)
      const rest = line.slice(8)
      const sep = rest.indexOf('::')
      const id = sep === -1 ? rest : rest.slice(0, sep)
      const msg = sep === -1 ? 'unknown error' : rest.slice(sep + 2)
      emit('step-error', id, msg)
      return
    }
    if (line.startsWith('##LOG::')) {
      emit('log', undefined, line.slice(7))
      return
    }
    if (line.startsWith('##END::')) {
      run.sawEnd = true
      return
    }
    emit('log', undefined, line)
  }

  let outBuf = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    outBuf += chunk.toString('utf8')
    const lines = outBuf.split(/\r?\n/)
    outBuf = lines.pop() ?? ''
    for (const l of lines) handleLine(l)
  })
  let errBuf = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    errBuf += chunk.toString('utf8')
    const lines = errBuf.split(/\r?\n/)
    errBuf = lines.pop() ?? ''
    for (const l of lines) if (l.trim()) emit('log', undefined, l)
  })

  child.on('error', (err) => {
    if (active !== run) return
    finish('run-error', `failed to start powershell: ${String(err)}`)
  })

  child.on('close', (code) => {
    if (active !== run) return
    if (outBuf) handleLine(outBuf)
    if (run.cancelled) {
      finish('run-cancelled')
    } else if (run.sawEnd) {
      finish('run-done')
    } else {
      finish('run-error', `powershell exited unexpectedly with code ${code ?? 'null'}`)
    }
  })
}

export async function executePlan(ex: ExecutablePlan, emit: EmitFn): Promise<void> {
  if (active) throw new Error('Another action is already running')
  await execute(ex, emit)
}
