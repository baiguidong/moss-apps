import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendFile = path.join(appRoot, 'dist', 'backend', 'main.mjs')
const uiFile = path.join(appRoot, 'dist', 'ui', 'index.html')

fs.mkdirSync(path.dirname(backendFile), { recursive: true })
fs.mkdirSync(path.dirname(uiFile), { recursive: true })

const result = spawnSync('bun', [
  'build',
  path.join(appRoot, 'src', 'backend', 'feishu', 'index.ts'),
  '--target=node',
  '--format=esm',
  `--outfile=${backendFile}`,
], {
  cwd: appRoot,
  stdio: 'inherit',
  env: process.env,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)

fs.copyFileSync(path.join(appRoot, 'src', 'index.html'), uiFile)
