import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

export function buildApp(root, external = []) {
  const run = (command, args) => { const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' }); if (result.error || result.status) throw result.error || new Error(`${command} failed`) }
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true })
  run('vite', ['build'])
  for (const name of ['main', 'worker']) run('bun', ['build', `src/backend/${name}.mjs`, '--target=node', '--format=esm', ...external.map(name => `--external=${name}`), `--outfile=dist/backend/${name}.mjs`])
  const visited = new Map(), target = path.join(root, 'dist/backend/node_modules'), platforms = JSON.parse(fs.readFileSync(path.join(root, 'marketplace.json'))).platforms
  function copy(name, require, optional = false) {
    let entry
    try { entry = require.resolve(`${name}/package.json`) }
    catch {
      entry = (require.resolve.paths(name) || []).map(directory => path.join(directory, name, 'package.json')).find(file => fs.existsSync(file))
      if (!entry) { if (optional) return; throw new Error(`Missing runtime dependency: ${name}`) }
    }
    const source = path.dirname(fs.realpathSync(entry)), pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')))
    if (optional && (name === '@fugood/node-whisper-wasm' || !platforms.some(platform => { const [os, cpu] = platform.split('-'); return (!pkg.os || pkg.os.includes(os)) && (!pkg.cpu || pkg.cpu.includes(cpu)) }))) return
    if (visited.has(name)) {
      if (visited.get(name) !== pkg.version) throw new Error(`Conflicting runtime versions for ${name}: ${visited.get(name)} and ${pkg.version}. Align the dependency versions before packaging.`)
      return
    }
    visited.set(name, pkg.version)
    fs.cpSync(source, path.join(target, name), { recursive: true, dereference: true, filter: file => path.basename(file) !== 'node_modules' && path.basename(file) !== '.git' })
    const nested = createRequire(path.join(source, 'package.json'))
    for (const dep of Object.keys(pkg.dependencies || {})) copy(dep, nested)
    for (const dep of Object.keys(pkg.optionalDependencies || {})) copy(dep, nested, true)
  }
  const require = createRequire(path.join(root, 'package.json'))
  for (const name of external) copy(name, require)
}
