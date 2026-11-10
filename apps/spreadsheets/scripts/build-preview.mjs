import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const upstream = path.resolve(path.dirname(require.resolve('@tanstack/table-core')), '../..')
await fs.mkdir(path.join(root, 'dist/preview'), { recursive: true })
execFileSync('bun', ['build', 'src/preview/table.mjs', '--target=browser', '--format=iife', '--minify', '--outfile=dist/preview/table.js'], { cwd: root, stdio: 'inherit' })
await fs.copyFile(path.join(upstream, 'LICENSE'), path.join(root, 'dist/preview/tanstack-table.LICENSE'))
const js = path.join(root, 'dist/preview/table.js')
await fs.writeFile(js, `/*! TanStack Table\n${await fs.readFile(path.join(upstream, 'LICENSE'), 'utf8')}\n*/\n${await fs.readFile(js, 'utf8')}`)
