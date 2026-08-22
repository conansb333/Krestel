import { appendFileSync } from 'node:fs'
import path from 'node:path'

const DEBUG_LOG = path.join(process.env.TEMP ?? process.cwd(), 'krestel-startup.log')

/** Best-effort startup/diagnostic breadcrumbs (krestel-startup.log in %TEMP%). */
export function crumb(message: string): void {
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${message}\n`)
  } catch {
    /* best effort */
  }
}
