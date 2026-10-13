import { buildAppSettings } from '@moss/app-settings/build'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('..', import.meta.url))
for (const [command, args] of [
  ['vite', ['build']],
  ['bun', ['build', 'src/backend/main.mjs', '--target=node', '--format=esm', '--outfile=dist/backend/main.mjs']],
]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

await buildAppSettings(fileURLToPath(new URL('..', import.meta.url)))
