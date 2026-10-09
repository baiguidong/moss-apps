import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const cwd = fileURLToPath(new URL('..', import.meta.url))
mkdirSync(new URL('../dist/backend/', import.meta.url), { recursive: true })
for (const [command, args] of [
  ['vite', ['build']],
  ['bun', ['build', 'src/backend/main.ts', '--target=node', '--format=esm', '--outfile=dist/backend/main.mjs']],
]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Copy the pinned production dependency closure, including Playwright's runtime assets
// and licenses. Building requires installed dependencies; running the archive never uses npm.
const require = createRequire(import.meta.url)
const target = path.join(cwd, 'dist/playwright-cdp')
rmSync(target, { recursive: true, force: true })
mkdirSync(path.join(target, 'node_modules'), { recursive: true })
const copied = new Map()
function copyPackage(name, fromRequire) {
  const manifestPath = fromRequire.resolve(`${name}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (copied.has(name)) {
    if (copied.get(name) !== manifest.version) throw new Error(`Conflicting bundled versions for ${name}`)
    return
  }
  copied.set(name, manifest.version)
  cpSync(path.dirname(manifestPath), path.join(target, 'node_modules', name), { recursive: true, dereference: true,
    filter: source => path.basename(source) !== 'node_modules' })
  const dependencyRequire = createRequire(manifestPath)
  for (const dependency of Object.keys(manifest.dependencies || {})) copyPackage(dependency, dependencyRequire)
}
copyPackage('@playwright/mcp', require)
cpSync(path.join(cwd, 'src/playwright-cdp'), target, { recursive: true })
writeFileSync(path.join(target, 'versions.json'), JSON.stringify(Object.fromEntries(copied), null, 2) + '\n')
console.log('Bundled offline Playwright MCP:', Object.fromEntries(copied))
