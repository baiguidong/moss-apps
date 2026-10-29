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
  const env = { PATH: process.env.PATH, HOME: os.homedir(), CI: '1', TMPDIR: os.tmpdir() }
  // A content-verified build cache is safe to share across isolated rebuilds.
  // Runtime packages never depend on this directory.
  if (process.env.MOSS_BUILD_DEPENDENCY_CACHE) {
    if (!path.isAbsolute(process.env.MOSS_BUILD_DEPENDENCY_CACHE)) throw new Error('Build dependency cache must be an absolute path')
    env.MOSS_BUILD_DEPENDENCY_CACHE = process.env.MOSS_BUILD_DEPENDENCY_CACHE
  }
  // PowerShell/CIM and Python need these Windows system locations even in an
  // isolated build. Keep the allowlist explicit so signing keys never enter it.
  for (const key of ['SystemRoot', 'SystemDrive', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'PSModulePath']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', timeout: 300000 })
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} ${args.join(' ')} failed (${result.status})`)
}

export async function exportAppSource(app, destination, { release = false, platform } = {}) {
  const rootPackage = readJson(path.join(repoRoot, 'package.json'))
  const bunVersion = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim()
  if (rootPackage.packageManager !== `bun@${bunVersion}`) throw new Error(`Expected ${rootPackage.packageManager}, found bun@${bunVersion}`)
  const appRoot = path.relative(repoRoot, app.root).split(path.sep).join('/')
  const localPaths = [appRoot, 'vendor/moss-core/packages/app-sdk', 'vendor/moss-core/packages/host-contracts']
  const appPackage = app.kind === 'tool' ? {
    name: `@moss/config-${app.directoryName}`, version: app.manifest.version, private: true, type: 'module',
    scripts: { check: 'node ../../scripts/build-tool-app.mjs --check', build: 'node ../../scripts/build-tool-app.mjs' },
    devDependencies: { '@moss/app-runtime': 'workspace:*' },
  } : readJson(path.join(app.root, 'package.json'))
  const appDependencies = dependencies(appPackage)
  // Shared App UI modules travel with each source package and its focused lock.
  const shared = new Map()
  for (const entry of await fs.readdir(path.join(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const relative = `packages/${entry.name}`
    const pkg = readJson(path.join(repoRoot, relative, 'package.json'))
    shared.set(pkg.name, { relative, pkg })
  }
  const pending = Object.keys(appDependencies)
  while (pending.length) {
    const local = shared.get(pending.pop())
    if (!local || localPaths.includes(local.relative)) continue
    localPaths.push(local.relative)
    pending.push(...Object.keys(dependencies(local.pkg)))
  }
  if (appDependencies['@moss/app-runtime']) localPaths.push('vendor/moss-core/packages/app-runtime')
  const appFiles = await sourceFileList(app.root, { filter: (name, entry) => !['node_modules', 'dist', '.git'].includes(entry.name) })
  for (const file of appFiles.filter(file => /\.[cm]?[jt]sx?$/.test(file.path))) {
    if ((await fs.readFile(path.join(app.root, file.path), 'utf8')).includes('packages/app-runtime/')) {
      if (!localPaths.includes('vendor/moss-core/packages/app-runtime')) localPaths.push('vendor/moss-core/packages/app-runtime')
      break
    }
  }
  const coreRoot = path.join(repoRoot, 'vendor/moss-core')
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const coreCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: coreRoot, encoding: 'utf8' }).trim()
  const coreDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--', 'packages'], { cwd: coreRoot, encoding: 'utf8' }).trim())
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim())
  if (release && (dirty || coreDirty)) throw new Error('Signed releases require committed App source and a clean pinned Core submodule; local packages record dirty content hashes.')
  await fs.mkdir(destination, { recursive: true })
  for (const relative of localPaths) await copySourceTree(path.join(repoRoot, relative), path.join(destination, relative))
  if (app.kind === 'tool') {
    await writeJson(path.join(destination, appRoot, 'package.json'), appPackage)
    await writeJson(path.join(destination, appRoot, 'app.moss.json'), app.manifest)
    await fs.mkdir(path.join(destination, 'scripts'), { recursive: true })
    await fs.copyFile(path.join(repoRoot, 'scripts/build-tool-app.mjs'), path.join(destination, 'scripts/build-tool-app.mjs'))
    await fs.copyFile(path.join(repoRoot, 'scripts/npm-command.mjs'), path.join(destination, 'scripts/npm-command.mjs'))
  }
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
  const rebuildCommands = ['check', 'test', 'build'].filter(name => appPackage.scripts?.[name]).map(name => `\`bun run ${name}\``).join(', ')
  await fs.writeFile(path.join(destination, 'README.md'), `# ${app.manifest.id} source\n\nApp edit root: ${appRoot}\n\nToolchain: ${workspace.packageManager}; Node ${process.versions.node}.\n\nFrom this directory run \`bun install --frozen-lockfile\`, then in \`${appRoot}\` run ${rebuildCommands}.\n\nDesktop/Host/browser integration scripts may require a complete Core checkout, browser binaries or explicit test configuration. Those external integrations are separate from the included business tests. Dependencies are downloaded from the pinned lockfile; no original workspace or source cache is needed.\n`)
  if (platform) {
    if (!app.manifest.platforms?.includes(platform)) throw new Error(`App does not declare build target ${platform}`)
    // Keep the copied source manifest: an older SDK normalizer may omit newer Host fields.
    const manifestPath = path.join(destination, appRoot, 'app.moss.json')
    await writeJson(manifestPath, { ...readJson(manifestPath), platforms: [platform] })
  }
  const spec = await inspectSourceProject(destination, { appRoot })
  const sdkFiles = await sourceFileList(path.join(destination, 'vendor/moss-core'))
  return { ...spec, origin: { kind: 'repository', repository: app.marketplace.repository, commit, appRoot, dirty, ...(platform ? { platform } : {}) },
    sdk: { coreCommit, dirty: coreDirty, path: 'vendor/moss-core/packages', sha256: sha256Hex(Buffer.from(JSON.stringify(sdkFiles))) } }
}
