import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const listApps = () => fs.readdirSync(path.join(repoRoot, 'apps')).flatMap(name => {
  const root = path.join(repoRoot, 'apps', name), manifest = path.join(root, 'app.moss.json')
  return fs.existsSync(manifest) ? [{ root, manifest: JSON.parse(fs.readFileSync(manifest, 'utf8')) }] : []
})

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
  package_name: JSON.parse(fs.readFileSync(path.join(app.root, 'package.json'), 'utf8')).name,
  app_dir: path.relative(repoRoot, app.root).split(path.sep).join('/'),
  version,
  tag,
}
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n')
}
console.log(JSON.stringify(values))
