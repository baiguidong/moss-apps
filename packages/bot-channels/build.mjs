import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, rm } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })
await mkdir('dist/backend', { recursive: true })
await mkdir('dist/ui', { recursive: true })
execFileSync('bun', ['build', 'src/backend/main.ts', '--target=node', '--format=esm', '--outfile=dist/backend/main.mjs'], { stdio: 'inherit' })
execFileSync('bun', ['build', 'src/main.tsx', '--target=browser', '--format=esm', '--outdir=dist/ui', '--production'], { stdio: 'inherit' })
await copyFile('src/index.html', 'dist/ui/index.html')
await cp(new URL('./gateway/', import.meta.url), 'dist/backend/gateway', { recursive: true })
await cp('gateway', 'dist/backend/gateway', { recursive: true })
await copyFile('resources/requirements.lock', 'dist/backend/requirements.lock')
