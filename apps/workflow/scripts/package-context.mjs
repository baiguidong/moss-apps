import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const appRoot = fileURLToPath(new URL('../', import.meta.url))
export const repoRoot = path.resolve(appRoot, '../..')
export const { id: appId, version } = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.moss.json'), 'utf8'))
export const archivePath = path.join(repoRoot, 'artifacts', appId, version, `${appId}-${version}.zip`)
export const reportsDir = path.join(repoRoot, 'artifacts', appId, 'verification', version)
export const coreRoot = process.env.MOSS_CORE_ROOT || path.join(repoRoot, 'vendor/moss-core')
export const requireSignature = process.argv.includes('--require-signature')
export const trustedPublishers = {
  moss: { keys: { 'release-1': fs.readFileSync(path.join(repoRoot, 'publishers/moss/release-1.pem'), 'utf8') } },
}
