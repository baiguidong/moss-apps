// Temporary workspace synchronization until the reviewed Core commit is pinned.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const appsRepo = fileURLToPath(new URL('../../..', import.meta.url))
const core = path.resolve(process.env.MOSS_CORE_ROOT || path.join(appsRepo, '../moss'))
const vendor = path.join(appsRepo, 'vendor/moss-core')
async function snapshot(root) {
  const hash = createHash('sha256')
  async function visit(source) {
    for (const entry of (await fs.readdir(source, { withFileTypes: true })).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (['node_modules', '.git'].includes(entry.name)) continue
      const file = path.join(source, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile()) { const bytes = await fs.readFile(file); hash.update(path.relative(root, file).split(path.sep).join('/')); hash.update(bytes) }
      else throw new Error(`Unsupported SDK source entry: ${file}`)
    }
  }
  for (const name of ['app-sdk', 'host-contracts']) await visit(path.join(root, 'packages', name))
  return hash.digest('hex')
}
const provenanceFile = new URL('../assets/core-sdk-provenance.json', import.meta.url)
if (process.argv.includes('--check')) {
  const provenance = JSON.parse(await fs.readFile(provenanceFile, 'utf8'))
  if (await snapshot(vendor) !== provenance.snapshotSha256) throw new Error('The vendored SDK differs from the recorded Core snapshot. Run scripts/sync-core-sdk.mjs before building.')
  console.log(`SDK snapshot verified: ${provenance.snapshotSha256}`)
} else {
async function sync(source, destination) {
  await fs.mkdir(destination, { recursive: true })
  for (const entry of (await fs.readdir(source, { withFileTypes: true })).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (['node_modules', '.git'].includes(entry.name)) continue
    const from = path.join(source, entry.name), to = path.join(destination, entry.name)
    if (entry.isDirectory()) await sync(from, to)
    else if (entry.isFile()) {
      const bytes = await fs.readFile(from)
      await fs.writeFile(to, bytes)
    }
  }
}
for (const name of ['app-sdk', 'host-contracts']) await sync(path.join(core, 'packages', name), path.join(vendor, 'packages', name))
const snapshotSha256 = await snapshot(core)
if (await snapshot(vendor) !== snapshotSha256) throw new Error('The vendored SDK contains stale or extra files. Resolve them before recording the snapshot.')
const provenance = { sourceCommit: execFileSync('git', ['rev-parse','HEAD'], { cwd: core, encoding: 'utf8' }).trim(),
  uncommittedSdkChanges: Boolean(execFileSync('git', ['status','--porcelain','--','packages/app-sdk','packages/host-contracts'], { cwd: core, encoding: 'utf8' }).trim()),
  snapshotSha256 }
await fs.writeFile(provenanceFile, JSON.stringify(provenance, null, 2) + '\n')
console.log(JSON.stringify(provenance))
}
