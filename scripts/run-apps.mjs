import { spawnSync } from 'node:child_process'
import { selectApps } from './lib.mjs'

const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error('Usage: node scripts/run-apps.mjs <script> [--app <id>]')

for (const app of selectApps(args)) {
  const result = spawnSync('bun', ['run', command], {
    cwd: app.root,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
