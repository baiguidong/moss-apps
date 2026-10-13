import { buildAppSettings } from '@moss/app-settings/build'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, cpSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const cwd = fileURLToPath(new URL('..', import.meta.url))
mkdirSync(path.join(cwd, 'dist/backend'), { recursive: true })
mkdirSync(path.join(cwd, 'dist/ui'), { recursive: true })
for (const [command, args] of [
  ['bun', ['build', 'src/backend/main.ts', '--target=node', '--format=esm', '--outfile=dist/backend/main.mjs']],
  ['bun', ['build', 'src/ui/main.ts', '--target=browser', '--format=esm', '--outfile=dist/ui/main.mjs']],
]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
for (const name of ['index.html', 'style.css']) cpSync(path.join(cwd, 'src/ui', name), path.join(cwd, 'dist/ui', name))

// Preserve the pinned production packages and their licenses, with no runtime npm.
const require = createRequire(import.meta.url)
const target = path.join(cwd, 'dist/sequential-server')
rmSync(target, { recursive: true, force: true })
mkdirSync(path.join(target, 'node_modules'), { recursive: true })
const copied = new Map()
function manifestFor(name, resolver) {
  for (const directory of resolver.resolve.paths(name) || []) {
    const candidate = path.join(directory, name, 'package.json')
    if (existsSync(candidate) && JSON.parse(readFileSync(candidate, 'utf8')).name === name) return realpathSync(candidate)
  }
  throw new Error(`Cannot locate production package ${name}`)
}
function copyPackage(name, resolver, parent = target) {
  const manifestPath = manifestFor(name, resolver)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const targetResolver = createRequire(path.join(parent, 'package.json'))
  let visible
  try { visible = manifestFor(name, targetResolver) } catch {}
  // Ignore packages outside the output tree when building inside the workspace.
  if (visible && !visible.startsWith(target + path.sep)) visible = undefined
  if (visible && JSON.parse(readFileSync(visible, 'utf8')).version === manifest.version) return
  const destination = path.join(visible ? parent : target, 'node_modules', name)
  const key = path.relative(target, destination).replaceAll(path.sep, '/')
  if (copied.has(key)) throw new Error(`Conflicting bundled versions at ${key}`)
  copied.set(key, manifest.version)
  cpSync(path.dirname(manifestPath), destination, { recursive: true, dereference: true,
    filter: source => path.basename(source) !== 'node_modules' })
  const dependencyRequire = createRequire(manifestPath)
  for (const dependency of Object.keys(manifest.dependencies || {})) copyPackage(dependency, dependencyRequire, destination)
  for (const dependency of Object.keys(manifest.peerDependencies || {})) {
    try { manifestFor(dependency, dependencyRequire) }
    catch (error) { if (manifest.peerDependenciesMeta?.[dependency]?.optional) continue; throw error }
    copyPackage(dependency, dependencyRequire, destination)
  }
}
for (const dependency of ['zod', '@modelcontextprotocol/server-sequential-thinking']) copyPackage(dependency, require)
cpSync(path.join(cwd, 'src/sequential-server'), target, { recursive: true })
writeFileSync(path.join(target, 'versions.json'), JSON.stringify(Object.fromEntries(copied), null, 2) + '\n')
console.log(`Bundled Sequential Thinking MCP and ${copied.size - 1} production dependencies`)

await buildAppSettings(fileURLToPath(new URL('..', import.meta.url)))
