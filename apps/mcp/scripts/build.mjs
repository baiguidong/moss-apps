import { buildAppSettings } from '@moss/app-settings/build'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'

// Remove stale browser assets from builds created before the extraction.
rmSync(new URL('../dist/playwright-cdp/', import.meta.url), { recursive: true, force: true })
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

await buildAppSettings(fileURLToPath(new URL('..', import.meta.url)))
