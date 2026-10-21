import { buildAppSettings } from '@moss/app-settings/build'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'

rmSync(new URL('../dist/backend/', import.meta.url), { recursive: true, force: true })
rmSync(new URL('../dist/playwright-cdp/', import.meta.url), { recursive: true, force: true })
const cwd = fileURLToPath(new URL('..', import.meta.url))
for (const [command, args] of [['vite', ['build']]]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

await buildAppSettings(fileURLToPath(new URL('..', import.meta.url)))
