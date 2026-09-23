import fs from 'node:fs'
import path from 'node:path'
import { selectApps } from './lib.mjs'

const apps = selectApps()
if (!apps.length) throw new Error('No Apps found under apps/')

const ids = new Set()
for (const app of apps) {
  if (ids.has(app.manifest.id)) throw new Error(`Duplicate App id: ${app.manifest.id}`)
  ids.add(app.manifest.id)
  if (!app.manifest.publisher) throw new Error(`${app.manifest.id} must declare a publisher`)
  if (Array.isArray(app.manifest.backend?.protocols)) {
    throw new Error(`${app.manifest.id} must declare backend.protocols by target`)
  }
  for (const relativePath of [app.manifest.icon, app.manifest.ui?.entry, app.manifest.backend?.entry]) {
    if (!relativePath) continue
    const absolutePath = path.join(app.root, relativePath)
    if (!fs.existsSync(absolutePath) && !relativePath.startsWith('dist/')) {
      throw new Error(`${app.manifest.id} references a missing file: ${relativePath}`)
    }
  }
  console.log(`validated ${app.manifest.id}@${app.manifest.version}`)
}
