import { buildApp } from '@moss/local-tasks/build'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
buildApp(fileURLToPath(new URL('..', import.meta.url)), ["pdf-lib", "pdfjs-dist", "@napi-rs/canvas", "tesseract.js", "@tesseract.js-data/eng", "@tesseract.js-data/chi_sim"])

const require = createRequire(import.meta.url)
const pdfjs = path.dirname(require.resolve('pdfjs-dist/package.json'))
for (const name of ['cmaps', 'standard_fonts', 'wasm']) fs.cpSync(path.join(pdfjs, name), fileURLToPath(new URL(`../dist/ui/pdf-assets/${name}`, import.meta.url)), { recursive: true })
