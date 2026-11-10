import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const upstream = path.resolve(path.dirname(require.resolve('uplot')), '..')
await fs.mkdir(path.join(root, 'dist/preview'), { recursive: true })
execFileSync('bun', ['build', 'src/preview/chart.mjs', '--target=browser', '--format=iife', '--minify', '--outfile=dist/preview/chart.js'], { cwd: root, stdio: 'inherit' })
await fs.copyFile(path.join(upstream, 'dist/uPlot.min.css'), path.join(root, 'dist/preview/chart.css'))
await fs.copyFile(path.join(upstream, 'LICENSE'), path.join(root, 'dist/preview/uplot.LICENSE'))
const js = path.join(root, 'dist/preview/chart.js')
await fs.writeFile(js, `/*! uPlot\n${await fs.readFile(path.join(upstream, 'LICENSE'), 'utf8')}\n*/\n${await fs.readFile(js, 'utf8')}`)
