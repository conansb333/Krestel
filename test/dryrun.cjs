// Verification harness: builds real plans for each mode, generates the exact
// PowerShell the app would run, forces DRYRUN=1, and executes it. PowerShell
// compiles the whole script before running, so a dry run also validates the
// syntax of every step body. No system changes are made (dry mode skips all
// step bodies).
const { writeFileSync } = require('node:fs')
const { buildExecutablePlan } = require('../out-test/plans.cjs')
const { buildScript } = require('../out-test/runner.cjs')

const allOn = {
  services: true,
  securityHealth: true,
  drivers: true,
  tasks: true,
  appx: true,
  filesProgram: true,
  filesData: true,
  atp: true,
  telemetry: true,
  smartScreen: true
}

async function main() {
  const mode = process.argv[2] || 'remove'
  const settings = { components: allOn, options: { restorePoint: false, backup: false, repairSystem: mode === 'restore' } }
  const ex = await buildExecutablePlan(settings, mode, { backup: false, dryRun: true })
  const script = '\ufeff' + buildScript(ex)
  const out = `out-test/dryrun-${mode}.ps1`
  writeFileSync(out, script, 'utf8')
  console.log(`${mode}: ${ex.steps.length} steps -> ${out}`)
}

void main()
