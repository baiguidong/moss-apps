import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'
import { copySourceTree, validateSourcePackage, sourcePath, runtimeFileList, restoreSourceModes } from '../vendor/moss-core/packages/app-runtime/src/packages/source.mjs'
import { validateAppPackage } from '../vendor/moss-core/packages/app-runtime/src/packages/index.mjs'
import { verifyPackageRuntime } from '../vendor/moss-core/packages/app-runtime/src/packages/verify-runtime.mjs'
import { repoRoot, selectApps } from './lib.mjs'
import { run } from './source-package.mjs'

export async function verifySourceArchive(archive, { rebuild = false, requireSignature = false } = {}) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-zip-source-')))
  const root = path.join(temp, 'package')
  try {
    const bytes = await fs.readFile(archive)
    if (bytes.length > 250 * 1024 * 1024) throw new Error('Archive exceeds package limit')
    let total = 0, count = 0
    const seen = new Set()
    const entries = unzipSync(bytes, { filter: entry => {
      const destination = sourcePath(root, entry.name)
      if (seen.has(destination)) throw new Error(`Duplicate archive path: ${entry.name}`)
      seen.add(destination)
      total += entry.originalSize; count++
      if (entry.originalSize > 50 * 1024 * 1024 || total > 250 * 1024 * 1024 || count > 10000) throw new Error('Expanded archive exceeds package limits')
      return true
    } })
    for (const [relative, data] of Object.entries(entries)) {
      const file = sourcePath(root, relative)
      if (relative.endsWith('/')) { await fs.mkdir(file, { recursive: true }); continue }
      await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data, { flag: 'wx' })
    }
    const signature = await fs.readFile(path.join(root, 'app-signature.json'), 'utf8').then(JSON.parse, () => null)
    const trustedPublishers = {}
    if (signature) {
      for (const value of [signature.publisherId, signature.keyId]) if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error('Invalid signing identity')
      trustedPublishers[signature.publisherId] = { keys: { [signature.keyId]: await fs.readFile(path.join(repoRoot, 'publishers', signature.publisherId, `${signature.keyId}.pem`), 'utf8') } }
    }
    const pkg = await validateAppPackage(root, { requireSource: true, requireTrustedPublisher: requireSignature, trustedPublishers })
    const source = await validateSourcePackage(root, { required: true })
    await verifyPackageRuntime(root, { nodeExecutable: process.execPath })
    if (rebuild) {
      const workspace = path.join(temp, 'workspace')
      await copySourceTree(source.root, workspace, { includeSdk: true })
      await restoreSourceModes(workspace, source.descriptor)
      for (const phase of ['install', 'check', 'test', 'build']) {
        const command = source.descriptor.commands[phase]
        if (command) run(command.argv[0], command.argv.slice(1), sourcePath(workspace, command.cwd))
      }
      const output = path.join(temp, 'rebuilt'), app = sourcePath(workspace, source.descriptor.appRoot)
      await fs.mkdir(output)
      for (const name of ['dist', 'schemas', 'assets', 'resources', 'README.md', 'LICENSE', 'LICENSE.md']) {
        try { await fs.cp(path.join(app, name), path.join(output, name), { recursive: true }) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      await fs.copyFile(path.join(root, 'app.moss.json'), path.join(output, 'app.moss.json'))
      if (JSON.stringify(await runtimeFileList(output)) !== JSON.stringify(await runtimeFileList(root))) throw new Error('ZIP source rebuild does not match shipped runtime files')
    }
    return { appId: pkg.manifest.id, version: pkg.manifest.version, sourceHash: source.descriptor.sourceHash, rebuild }
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2)
  const files = argv.filter(arg => arg.endsWith('.zip'))
  if (!files.length) for (const app of selectApps(argv)) files.push(path.join(repoRoot, 'artifacts', app.manifest.id, app.manifest.version, `${app.manifest.id}-${app.manifest.version}.zip`))
  for (const file of files) console.log(JSON.stringify(await verifySourceArchive(file, { rebuild: argv.includes('--rebuild'), requireSignature: argv.includes('--require-signature') })))
}
