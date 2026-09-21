import fs from 'node:fs'
import path from 'node:path'
import { listApps, repoRoot } from './lib.mjs'

const tag = String(process.argv[2] || '').trim()
const match = tag.match(/^(.+)-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/)
if (!match) throw new Error(`Invalid release tag: ${tag}`)
const [, appId, version] = match
const app = listApps().find((candidate) => candidate.manifest.id === appId)
if (!app) throw new Error(`Tag references an unknown App: ${appId}`)
if (app.manifest.version !== version) {
  throw new Error(`Tag ${tag} does not match app.moss.json version ${app.manifest.version}`)
}
const values = {
  app_id: appId,
  app_dir: path.relative(repoRoot, app.root).split(path.sep).join('/'),
  version,
  tag,
}
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n')
}
console.log(JSON.stringify(values))
