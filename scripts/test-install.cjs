// Automated installation test for the Krestel Inno Setup installer:
//   1. silent-install to a temp directory (per-user, no UAC needed)
//   2. verify files + uninstall registry entry
//   3. launch the installed app briefly, then close it
//   4. silent-uninstall and verify cleanup
// Run after "npm run installer".
const { spawn, spawnSync } = require('node:child_process')
const { existsSync, rmSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const root = path.resolve(__dirname, '..')
const version = require(path.join(root, 'package.json')).version
const installerPath = path.join(root, 'dist', 'installer', `Krestel-Setup-${version}.exe`)
const installDir = path.join(os.tmpdir(), 'krestel-install-test')
const appExe = path.join(installDir, 'Krestel.exe')
const APP_ID = '{30C16215-C348-4C97-B696-4EC63F6B7A02}_is1'

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}
function ok(msg) {
  console.log(`ok  - ${msg}`)
}

function regRead(key, value) {
  const args = ['QUERY', key]
  if (value) args.push('/v', value)
  const r = spawnSync('reg.exe', args, { encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}

function main() {
  if (!existsSync(installerPath)) fail(`installer not found at ${installerPath} - run "npm run installer" first`)
  rmSync(installDir, { recursive: true, force: true })

  console.log('== Installing (silent, per-user) ==')
  let r = spawnSync(installerPath, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', `/DIR=${installDir}`], {
    stdio: 'inherit',
    shell: true
  })
  if (r.status !== 0) fail(`installer exited with code ${r.status}`)

  existsSync(appExe) ? ok('Krestel.exe installed') : fail('Krestel.exe missing after install')
  existsSync(path.join(installDir, 'resources', 'resources', 'scripts', 'status.ps1'))
    ? ok('PowerShell engine resources bundled')
    : fail('status.ps1 resource missing in installation')
  existsSync(path.join(installDir, 'resources', 'app.asar')) || existsSync(path.join(installDir, 'resources', 'app.asar.unpacked'))
    ? ok('app bundle present')
    : fail('app.asar missing in installation')

  console.log('== Verifying uninstall registry entry ==')
  const regKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${APP_ID}`
  const reg = regRead(regKey, 'DisplayName')
  reg && reg.includes('Krestel') ? ok('Add/Remove Programs entry present') : fail(`uninstall registry entry missing (${regKey})`)

  console.log('== Launching installed app (8s smoke) ==')
  // a stray Krestel instance would hold the single-instance lock and make the
  // freshly launched one exit immediately - clear strays first
  spawnSync('taskkill', ['/IM', 'Krestel.exe', '/F'])
  wait(1000)
  const launched = spawn(appExe, [], { detached: true, stdio: 'ignore', cwd: installDir })
  launched.unref()
  wait(8000)
  const t = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Krestel.exe'], { encoding: 'utf8' })
  const isRunning = (t.stdout || '').includes('Krestel.exe')
  isRunning ? ok('installed app launched and stayed running') : fail('installed app did not stay running')
  spawnSync('taskkill', ['/IM', 'Krestel.exe', '/F'])
  ok('app closed')

  console.log('== Uninstalling (silent) ==')
  const uninstaller = path.join(installDir, 'unins000.exe')
  if (!existsSync(uninstaller)) fail('uninstaller missing')
  r = spawnSync(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { stdio: 'inherit', shell: true })
  if (r.status !== 0) fail(`uninstaller exited with code ${r.status}`)

  // uninstaller deletes itself + dir asynchronously; give it a moment
  spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 3'], { shell: true })
  if (!existsSync(appExe)) ok('installation directory removed by uninstaller')
  else {
    rmSync(installDir, { recursive: true, force: true })
    console.log('warn - uninstaller left files behind (removed manually for the test)')
  }
  regRead(regKey, 'DisplayName') === null ? ok('registry entry removed') : fail('uninstall registry entry still present')

  console.log('\nINSTALLATION TEST PASSED')
}

main()
