import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createMcpAppManifest, generateMcpApp } from '../vendor/moss-core/packages/app-runtime/src/packages/generate-mcp-app.mjs'

// The same script ships in each source snapshot. No per-App executable code.
const root = process.cwd()
const definition = JSON.parse(await fs.readFile(path.join(root, 'app.json'), 'utf8'))
const manifest = createMcpAppManifest(definition)
const recorded = await fs.readFile(path.join(root, 'app.moss.json'), 'utf8').then(JSON.parse, error => {
  if (error.code !== 'ENOENT') throw error
})
if (recorded && JSON.stringify(recorded) !== JSON.stringify(manifest)) throw new Error('MCP definition and source manifest differ')
const check = process.argv.includes('--check')
const output = check ? await fs.mkdtemp(path.join(os.tmpdir(), 'moss-mcp-check-')) : path.join(root, 'dist')
try {
  if (!check) await fs.rm(output, { recursive: true, force: true })
  const resourcesDir = path.join(root, 'resources')
  const hasResources = await fs.stat(resourcesDir).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false })
  await generateMcpApp({ definition, resourcesDir: hasResources ? resourcesDir : undefined, destination: output })
} finally {
  if (check) await fs.rm(output, { recursive: true, force: true })
}
