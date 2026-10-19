import { spawnSync } from 'node:child_process'
import { readJson, repoRoot, selectApps } from './lib.mjs'

const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error('Usage: node scripts/run-apps.mjs <script> [--app <id>]')

for (const app of selectApps(args)) {
  if (app.kind === 'mcp' && command === 'test') continue
  if (app.kind === 'app' && command === 'test' && !readJson(`${app.root}/package.json`).scripts?.test) continue
  const binary = app.kind === 'mcp' ? 'node' : 'bun'
  const argv = app.kind === 'mcp' ? [`${repoRoot}/scripts/build-mcp-app.mjs`, ...(command === 'check' ? ['--check'] : [])] : ['run', command]
  if (app.kind === 'mcp' && !['check', 'build'].includes(command)) throw new Error(`Unsupported MCP script: ${command}`)
  const result = spawnSync(binary, argv, {
    cwd: app.root,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
