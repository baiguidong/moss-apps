import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
await rm(new URL('dist/', root), { recursive: true, force: true })
await mkdir(new URL('dist/backend/', root), { recursive: true })
await mkdir(new URL('dist/ui/', root), { recursive: true })

function build(args) {
  execFileSync('bun', ['build', ...args], { cwd: fileURLToPath(root), stdio: 'inherit' })
}

build([
  'src/backend/main.ts', '--target=node', '--format=esm', '--outfile=dist/backend/main.mjs',
])
build(['src/main.tsx', '--target=browser', '--format=esm', '--outdir=dist/ui', '--production'])
await copyFile(new URL('src/index.html', root), new URL('dist/ui/index.html', root))
await cp(new URL('src/gateway/', root), new URL('dist/backend/gateway/', root), { recursive: true })
await copyFile(new URL('resources/requirements.lock', root), new URL('dist/backend/requirements.lock', root))
