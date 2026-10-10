import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('..', import.meta.url))
const verification = spawnSync(process.execPath, ['scripts/sync-core-sdk.mjs', '--check'], { cwd, stdio: 'inherit' })
if (verification.error || verification.status !== 0) throw verification.error || new Error('SDK snapshot verification failed')
const schemas = spawnSync(process.execPath, ['scripts/generate-tool-schemas.mjs', '--check'], { cwd, stdio: 'inherit' })
if (schemas.error || schemas.status !== 0) throw schemas.error || new Error('Tool schema verification failed')
await fs.rm(new URL('../dist', import.meta.url), { recursive: true, force: true })
await fs.mkdir(new URL('../dist/ui', import.meta.url), { recursive: true })
await fs.mkdir(new URL('../dist/backend', import.meta.url), { recursive: true })
for (const [source, target, environment] of [['src/ui/main.mjs', 'dist/ui/main.mjs', 'browser'], ['src/backend/main.mjs', 'dist/backend/main.mjs', 'node']]) {
  const result = spawnSync('bun', ['build', source, `--target=${environment}`, '--format=esm', `--outfile=${target}`], { cwd, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw result.error || new Error('App build failed')
}
for (const name of ['index.html', 'style.css']) await fs.copyFile(new URL(`../src/ui/${name}`, import.meta.url), new URL(`../dist/ui/${name}`, import.meta.url))
