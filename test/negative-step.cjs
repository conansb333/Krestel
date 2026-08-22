// Negative test: executes the REAL 'Stop and disable antivirus services' step
// body from a plan built by buildExecutablePlan, in an unelevated shell.
// sc.exe config is denied for non-admins, so the step's outcome verification
// must throw with the Tamper Protection hint - proving silent failures are
// now loud failures. Safe to run: the denied operations change nothing.
const { writeFileSync } = require('node:fs')
const path = require('node:path')
const { buildExecutablePlan } = require('../out-test/plans.cjs')

const allOn = {
  services: true, securityHealth: true, drivers: true, tasks: true, appx: true,
  filesProgram: true, filesData: true, atp: true, telemetry: true, smartScreen: true
}

async function main() {
  const settings = { components: allOn, options: { restorePoint: false, backup: false, repairSystem: false } }
  const ex = await buildExecutablePlan(settings, 'disable', {})
  const step = ex.steps.find((s) => s.title.includes('antivirus services'))
  if (!step) throw new Error('services step not found in disable plan')
  const script = [
    '$ErrorActionPreference = "Continue"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'function Log([string]$m) { Write-Output ("##LOG::" + $m) }',
    'function StepFail([string]$i, [string]$m) { Write-Output ("##FAIL::" + $i + "::" + (([string]$m) -replace "\\r?\\n", " | ")) }',
    'try {',
    ...step.ps,
    '  Write-Output "##DONE::svc"',
    '} catch {',
    '  StepFail "svc" ([string]$_.Exception.Message)',
    '}'
  ].join('\r\n')
  const out = path.join(__dirname, '..', 'out-test', 'negative-svc.ps1')
  writeFileSync(out, '\ufeff' + script, 'utf8')
  console.log('wrote', out)
}

void main()
