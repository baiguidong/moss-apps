import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// Copy the installed production dependency graph, preserving conflicting versions.
// Resolving package.json through search paths also works for packages with exports.
export function bundleDependencies(entry, destination, resolver) {
  const copied = new Map()
  function manifestFor(name, from) {
    for (const directory of from.resolve.paths(name) || []) {
      const file = path.join(directory, name, 'package.json')
      if (fs.existsSync(file)) return fs.realpathSync(file)
    }
    throw new Error(`Missing production dependency: ${name}`)
  }
  function copy(name, from, parent = destination, optional = false) {
    let file
    try { file = manifestFor(name, from) } catch (error) { if (optional) return; throw error }
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (optional && ((pkg.os && !pkg.os.includes(process.platform)) || (pkg.cpu && !pkg.cpu.includes(process.arch)))) return
    let visible
    try { visible = manifestFor(name, createRequire(path.join(parent, 'package.json'))) } catch {}
    if (visible && !visible.startsWith(destination + path.sep)) visible = undefined
    if (visible && JSON.parse(fs.readFileSync(visible, 'utf8')).version === pkg.version) return
    const target = path.join(visible ? parent : destination, 'node_modules', name)
    const key = path.relative(destination, target)
    if (copied.has(key)) throw new Error(`Conflicting dependency at ${key}`)
    copied.set(key, pkg.version)
    fs.cpSync(path.dirname(file), target, { recursive: true, dereference: true, filter: source => path.basename(source) !== 'node_modules' })
    const child = createRequire(file)
    for (const dependency of Object.keys(pkg.dependencies || {})) copy(dependency, child, target, Object.hasOwn(pkg.optionalDependencies || {}, dependency))
    for (const dependency of Object.keys(pkg.optionalDependencies || {})) copy(dependency, child, target, true)
    for (const dependency of Object.keys(pkg.peerDependencies || {})) copy(dependency, child, target, pkg.peerDependenciesMeta?.[dependency]?.optional === true)
  }
  copy(entry, resolver)
  fs.writeFileSync(path.join(destination, 'dependencies.json'), JSON.stringify(Object.fromEntries(copied), null, 2) + '\n')
  return copied.size
}
