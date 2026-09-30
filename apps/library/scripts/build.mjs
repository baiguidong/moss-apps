import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cp, rm } from 'node:fs/promises'
import path from 'node:path'
import { preparePython } from './prepare-python.mjs'
const cwd = fileURLToPath(new URL('..', import.meta.url))
await rm(path.join(cwd, 'dist/backend'), { recursive: true, force: true })
await preparePython(path.join(cwd, 'dist/backend/python'))
await cp(path.join(cwd, 'src/backend/library_parser.py'), path.join(cwd, 'dist/backend/library_parser.py'))
for (const [command, args] of [
  ['vite', ['build']],
  ['bun', ['build', 'src/backend/main.mjs', '--target=node', '--format=esm', '--outfile=dist/backend/main.mjs']],
]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
