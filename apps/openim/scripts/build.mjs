import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendFile = path.join(appRoot, 'dist', 'backend', 'main.mjs')
fs.mkdirSync(path.dirname(backendFile), { recursive: true })

for (const command of [
  ['vite', ['build']],
  ['bun', ['build', path.join(appRoot, 'src', 'backend', 'main.ts'), '--target=node', '--format=esm', `--outfile=${backendFile}`]],
]) {
  const result = spawnSync(command[0], command[1], {
    cwd: appRoot,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
