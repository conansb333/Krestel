// Krestel installer builder - one command end-to-end:
//   1. electron-vite build (main + preload + renderer)
//   2. electron-builder --win --dir (produces dist/win-unpacked with the icon)
//   3. Inno Setup (ISCC.exe) compiles installer/krestel.iss -> dist/installer/Krestel-Setup-<ver>.exe
const { spawnSync } = require('node:child_process')
const { existsSync, mkdirSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', cwd: root, ...opts })
  if (result.status !== 0) {
    console.error(`Command failed with exit code ${result.status}: ${cmd}`)
    process.exit(result.status ?? 1)
  }
}

function findIscc() {
  const candidates = [
    process.env.ISCC,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Inno Setup 6', 'ISCC.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe')
  ].filter(Boolean)
  for (const c of candidates) if (c && existsSync(c)) return c
  const where = spawnSync('where', ['ISCC'], { shell: true, encoding: 'utf8' })
  if (where.status === 0 && where.stdout.trim()) return where.stdout.trim().split(/\r?\n/)[0]
  return null
}

function main() {
  if (process.platform !== 'win32') {
    console.error('The installer can only be built on Windows.')
    process.exit(1)
  }
  console.log('== 1/3 Building app bundles ==')
  run('npx', ['electron-vite', 'build'])

  console.log('== 2/3 Packing win-unpacked ==')
  run('npx', ['electron-builder', '--win', '--dir'])

  const iscc = findIscc()
  if (!iscc) {
    console.error(
      'Inno Setup 6 not found. Install it from https://jrsoftware.org/isdl.php (or "winget install JRSoftware.InnoSetup"), then re-run.'
    )
    process.exit(1)
  }
  console.log(`== 3/3 Compiling Inno Setup installer (${iscc}) ==`)
  mkdirSync(path.join(root, 'dist', 'installer'), { recursive: true })
  run(iscc, [path.join('installer', 'krestel.iss')], { shell: false })

  console.log('\nDone. Installer: dist\\installer\\Krestel-Setup-1.0.0.exe')
}

main()
