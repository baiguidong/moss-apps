import { buildApp } from '@moss/local-tasks/build'
import { fileURLToPath } from 'node:url'
buildApp(fileURLToPath(new URL('..', import.meta.url)), ["@pdf-lib/fontkit", "pdf-lib", "pdfjs-dist", "@napi-rs/canvas", "tesseract.js", "@tesseract.js-data/eng", "@tesseract.js-data/chi_sim"])

const cli = await import('node:child_process')
cli.execFileSync('bun', ['build', 'src/backend/cli.mjs', '--target=node', '--format=esm', '--outfile=dist/backend/cli.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' })
