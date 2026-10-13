import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { repoRoot, selectApps } from './lib.mjs'
import { mergeReleaseVersions } from './release-variants.mjs'
import { verifySourceArchive } from './verify-source-package.mjs'

const [appId, version] = process.argv.slice(2)
const app = selectApps(['--app', appId])[0]
if (!app || app.manifest.version !== version || !app.manifest.platforms?.length) throw new Error('Unknown platform release')
const root = path.join(repoRoot, 'artifacts', appId, version)
let merged
for (const platform of app.manifest.platforms) {
  const stem = `${appId}-${version}-${platform}`
  const record = JSON.parse(await fs.readFile(path.join(root, `${stem}.release.json`), 'utf8'))
  if (record.app.id !== appId || record.version.version !== version || JSON.stringify(record.version.platforms) !== JSON.stringify([platform])) throw new Error(`Release identity mismatch: ${platform}`)
  merged = mergeReleaseVersions(merged, record.version)
  const artifact = record.version.artifacts?.[platform]
  if (!artifact?.signed || artifact.fileName !== `${stem}.zip`) throw new Error(`Missing signed platform artifact: ${platform}`)
  const archive = path.join(root, artifact.fileName), bytes = await fs.readFile(archive)
  if (bytes.length !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error(`Release bytes mismatch: ${platform}`)
  const verified = await verifySourceArchive(archive, { requireSignature: true })
  if (verified.appId !== appId || verified.version !== version || JSON.stringify(verified.platforms) !== JSON.stringify([platform])) throw new Error(`Signed package target mismatch: ${platform}`)
}
console.log(`Verified ${appId}@${version}: ${merged.platforms.join(', ')}`)
