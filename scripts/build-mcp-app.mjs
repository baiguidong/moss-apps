import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
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
  const runtimeSource = path.join(root, 'runtime')
  const hasRuntime = await fs.stat(path.join(runtimeSource, 'package-lock.json')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
  const preparedRuntime = hasRuntime ? await fs.mkdtemp(path.join(os.tmpdir(), 'moss-mcp-runtime-')) : undefined
  try {
  if (preparedRuntime) {
    await fs.cp(runtimeSource, preparedRuntime, { recursive: true })
    const result = spawnSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: preparedRuntime, stdio: 'inherit', timeout: 300000,
    })
    if (result.error || result.status !== 0) throw result.error || new Error(`Bundled MCP dependency install failed (${result.status})`)
    await fs.rm(path.join(preparedRuntime, 'node_modules/.bin'), { recursive: true, force: true })
  }
  await generateMcpApp({ definition, resourcesDir: hasResources ? resourcesDir : undefined, runtimeDir: preparedRuntime, destination: output })
  } finally { if (preparedRuntime) await fs.rm(preparedRuntime, { recursive: true, force: true }) }
} finally {
  if (check) await fs.rm(output, { recursive: true, force: true })
}
