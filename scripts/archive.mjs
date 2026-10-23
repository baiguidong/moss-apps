import { zipSync } from 'fflate'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function findExecutablePaths(files) {
  const names = new Set(files.map(file => file.relativePath))
  const executable = new Set()
  for (const file of files) {
    if ((await fs.stat(file.absolutePath)).mode & 0o111) executable.add(file.relativePath)
    if (!file.relativePath.startsWith('runtime/node_modules/') || path.posix.basename(file.relativePath) !== 'package.json') continue
    const pkg = JSON.parse(await fs.readFile(file.absolutePath, 'utf8'))
    const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {})
    const directory = path.posix.dirname(file.relativePath)
    for (const bin of bins) {
      if (typeof bin !== 'string') continue
      const target = path.posix.normalize(path.posix.join(directory, bin))
      if (target.startsWith(directory + '/') && names.has(target)) executable.add(target)
    }
  }
  return [...executable].sort()
}

export function createDeterministicZip(entries, { executablePaths = [] } = {}) {
  // ZIP stores a local DOS calendar date. UTC midnight becomes 1979 in western
  // time zones, which is outside ZIP's supported range.
  const mtime = new Date(1980, 0, 1, 0, 0, 0)
  const executable = new Set(executablePaths)
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [
    name, [bytes, { mtime, ...(executable.has(name) ? { os: 3, attrs: (0o100700 << 16) >>> 0 } : {}) }],
  ])), { level: 9 }))
}
