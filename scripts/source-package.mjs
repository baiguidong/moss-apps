import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { repoRoot, readJson, writeJson, sha256Hex } from './lib.mjs'
import { copySourceTree, sourceFileList, inspectSourceProject } from '../vendor/moss-core/packages/app-runtime/src/packages/source.mjs'

// Bun's text lockfile uses JSON with trailing commas, no executable expressions.
export const parseLock = text => JSON.parse(text.replace(/,\s*([}\]])/g, '$1'))
const dependencies = pkg => ({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies })
const parentKey = key => key.replace(/(?:^|\/)(?:@[^/]+\/)?[^/]+$/, '')

/** Keep the original resolved tuples, including integrity and nested resolutions. */
export function focusedLock(original, workspaces) {
  const selected = new Map()
  const resolve = (name, from = '') => {
    for (let prefix = from; ; prefix = parentKey(prefix)) {
      const key = prefix ? `${prefix}/${name}` : name
      if (original.packages[key]) return key
      if (!prefix) return null
    }
  }
  function visit(name, from = '', optional = false) {
    const key = resolve(name, from)
    if (!key) { if (optional) return; throw new Error(`Lockfile dependency missing: ${name} (from ${from})`) }
    if (selected.has(key)) return
    const tuple = original.packages[key]
    if (tuple[0].includes('@workspace:')) return
    selected.set(key, tuple)
    const metadata = tuple[2] || {}
    for (const dep of Object.keys(metadata.dependencies || {})) visit(dep, key)
    for (const dep of Object.keys({ ...metadata.optionalDependencies, ...metadata.peerDependencies })) visit(dep, key, true)
  }
  const workspaceEntries = {}
  for (const [relative, pkg] of Object.entries(workspaces)) {
    workspaceEntries[relative] = Object.fromEntries(['name', 'version', 'dependencies', 'devDependencies', 'optionalDependencies'].filter(key => pkg[key] !== undefined).map(key => [key, pkg[key]]))
    if (relative) selected.set(pkg.name, [`${pkg.name}@workspace:${relative}`])
  }
  for (const pkg of Object.values(workspaces)) for (const name of Object.keys(dependencies(pkg))) {
    if (!Object.values(workspaces).some(local => local.name === name)) visit(name, pkg.name)
  }
  return { lockfileVersion: original.lockfileVersion, configVersion: original.configVersion, workspaces: workspaceEntries, packages: Object.fromEntries([...selected].sort(([a], [b]) => a.localeCompare(b))) }
}

export function run(command, args, cwd) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: os.homedir(), CI: '1', TMPDIR: os.tmpdir() }
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', timeout: 300000 })
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} ${args.join(' ')} failed (${result.status})`)
}

export async function exportAppSource(app, destination, { release = false } = {}) {
  const rootPackage = readJson(path.join(repoRoot, 'package.json'))
  const bunVersion = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim()
  if (rootPackage.packageManager !== `bun@${bunVersion}`) throw new Error(`Expected ${rootPackage.packageManager}, found bun@${bunVersion}`)
  const appRoot = path.relative(repoRoot, app.root).split(path.sep).join('/')
  const localPaths = [appRoot, 'vendor/moss-core/packages/app-sdk', 'vendor/moss-core/packages/host-contracts']
  const appFiles = await sourceFileList(app.root, { filter: (name, entry) => !['node_modules', 'dist', '.git'].includes(entry.name) })
  for (const file of appFiles.filter(file => /\.[cm]?[jt]sx?$/.test(file.path))) {
    if ((await fs.readFile(path.join(app.root, file.path), 'utf8')).includes('packages/app-runtime/')) { localPaths.push('vendor/moss-core/packages/app-runtime'); break }
  }
  const coreRoot = path.join(repoRoot, 'vendor/moss-core')
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const coreCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: coreRoot, encoding: 'utf8' }).trim()
  const coreDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--', 'packages'], { cwd: coreRoot, encoding: 'utf8' }).trim())
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim())
  if (release && (dirty || coreDirty)) throw new Error('Signed releases require committed App source and a clean pinned Core submodule; local packages record dirty content hashes.')
  await fs.mkdir(destination, { recursive: true })
  for (const relative of localPaths) await copySourceTree(path.join(repoRoot, relative), path.join(destination, relative))
  for (const name of ['LICENSE', 'LICENSE.md']) {
    try { await fs.copyFile(path.join(coreRoot, name), path.join(destination, 'vendor/moss-core', name)) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const workspace = { name: rootPackage.name, version: rootPackage.version, private: true, type: 'module', packageManager: rootPackage.packageManager,
    workspaces: localPaths, devDependencies: rootPackage.devDependencies }
  await writeJson(path.join(destination, 'package.json'), workspace)
  const workspaces = { '': workspace }
  for (const relative of localPaths) workspaces[relative] = readJson(path.join(destination, relative, 'package.json'))
  const lock = focusedLock(parseLock(await fs.readFile(path.join(repoRoot, 'bun.lock'), 'utf8')), workspaces)
  await writeJson(path.join(destination, 'bun.lock'), lock)
  await fs.writeFile(path.join(destination, 'README.md'), `# ${app.manifest.id} source\n\nApp edit root: ${appRoot}\n\nToolchain: ${workspace.packageManager}; Node ${process.versions.node}.\n\nFrom this directory run \`bun install --frozen-lockfile\`, then in \`${appRoot}\` run \`bun run check\`, \`bun run test\`, and \`bun run build\`.\n\nDesktop/Host/browser integration scripts may require a complete Core checkout, browser binaries or explicit test configuration. Those external integrations are separate from the included business tests. Dependencies are downloaded from the pinned lockfile; no original workspace or source cache is needed.\n`)
  const spec = await inspectSourceProject(destination, { appRoot })
  const sdkFiles = await sourceFileList(path.join(destination, 'vendor/moss-core'))
  return { ...spec, origin: { kind: 'repository', repository: app.marketplace.repository, commit, appRoot, dirty },
    sdk: { coreCommit, dirty: coreDirty, path: 'vendor/moss-core/packages', sha256: sha256Hex(Buffer.from(JSON.stringify(sdkFiles))) } }
}
