import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { selectApps } from './lib.mjs'
import { exportAppSource, parseLock, run } from './source-package.mjs'

// Diagnostic only: never produces or signs a release package.
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-lock-diagnostic-')))
try {
  await exportAppSource(selectApps(['--app', 'moss.app-builder'])[0], root)
  const before = parseLock(await fs.readFile(path.join(root, 'bun.lock'), 'utf8'))
  run('bun', ['install', '--lockfile-only', '--ignore-scripts'], root)
  const after = parseLock(await fs.readFile(path.join(root, 'bun.lock'), 'utf8'))
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue
    if (typeof before[field] !== 'object' || typeof after[field] !== 'object') { console.log(JSON.stringify({ field, before: before[field], after: after[field] })); continue }
    for (const key of new Set([...Object.keys(before[field]), ...Object.keys(after[field])])) {
      if (JSON.stringify(before[field][key]) !== JSON.stringify(after[field][key])) console.log(JSON.stringify({ field, key, before: before[field][key], after: after[field][key] }))
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }) }
