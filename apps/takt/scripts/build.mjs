import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { buildAppSettings } from '@moss/app-settings/build'
import { appRoot, buildBackend } from './engine-build.mjs'
fs.rmSync(path.join(appRoot, 'dist'), { recursive: true, force: true })
await buildBackend({ main: 'src/backend/main.mjs', worker: 'src/backend/worker.mjs' }, path.join(appRoot, 'dist/backend'))
await build({ absWorkingDir: appRoot, entryPoints: ['src/ui/main.tsx'], outdir: 'dist/ui', bundle: true, minify: true, format: 'esm', target: 'chrome132', loader: { '.svg': 'dataurl' } })
fs.copyFileSync(path.join(appRoot, 'src/ui/index.html'), path.join(appRoot, 'dist/ui/index.html'))
fs.copyFileSync(path.join(appRoot, 'resources/example.yaml'), path.join(appRoot, 'dist/ui/example.yaml'))
await buildAppSettings(appRoot)
console.log('Built moss.takt@' + JSON.parse(fs.readFileSync(path.join(appRoot, 'app.moss.json'))).version)
