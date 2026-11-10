import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { isDeepStrictEqual } from 'node:util'
import { spawnSync } from 'node:child_process'
import { npmInvocation } from './npm-command.mjs'
import { pythonBundle, pythonBundleManifest, buildPythonBundle } from './bundled-python.mjs'
import { pathToFileURL } from 'node:url'

// The same script ships in each source snapshot. No per-App executable code.
const root = process.cwd()
const sourceRoot = path.resolve(root, '../..')
const coreRoot = await fs.stat(path.join(sourceRoot, '.moss-sdk')).then(() => path.join(sourceRoot, '.moss-sdk')).catch(() => path.join(sourceRoot, 'vendor/moss-core'))
const { ensureSafeRelativePath } = await import(pathToFileURL(path.join(coreRoot, 'packages/app-sdk/src/schemas/index.mjs')))
const { createToolAppManifest, generateToolApp } = await import(pathToFileURL(path.join(coreRoot, 'packages/app-runtime/src/packages/generate-tool-app.mjs')))
const definition = JSON.parse(await fs.readFile(path.join(root, 'app.json'), 'utf8'))
const python = pythonBundle(root)
let manifest = pythonBundleManifest(createToolAppManifest(definition), root)
const recorded = await fs.readFile(path.join(root, 'app.moss.json'), 'utf8').then(JSON.parse, error => {
  if (error.code !== 'ENOENT') throw error
})
if (python && recorded?.platforms?.length === 1 && python.platforms.includes(recorded.platforms[0])) manifest = { ...manifest, platforms: recorded.platforms }
if (recorded && !isDeepStrictEqual(recorded, manifest)) throw new Error('Tool definition and source manifest differ')
const check = process.argv.includes('--check')
const output = check ? await fs.mkdtemp(path.join(os.tmpdir(), 'moss-mcp-check-')) : path.join(root, 'dist')
try {
  if (!check) await fs.rm(output, { recursive: true, force: true })
  const resourcesDir = path.join(root, 'resources')
  const hasResources = await fs.stat(resourcesDir).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false })
  const runtimeSource = path.join(root, 'runtime')
  const hasRuntime = await fs.stat(path.join(runtimeSource, 'package-lock.json')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
  const preparedRuntime = hasRuntime || python ? await fs.mkdtemp(path.join(os.tmpdir(), 'moss-mcp-runtime-')) : undefined
  try {
  if (hasRuntime) {
    await fs.cp(runtimeSource, preparedRuntime, { recursive: true })
    const runtimePackage = JSON.parse(await fs.readFile(path.join(preparedRuntime, 'package.json'), 'utf8'))
    const platformOptions = runtimePackage.mossBundleAllPlatforms === true ? ['--force', '--bin-links=false'] : []
    const npm = npmInvocation()
    const result = spawnSync(npm.command, [...npm.args, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...platformOptions], {
      cwd: preparedRuntime, stdio: 'inherit', timeout: 300000, windowsHide: true,
    })
    if (result.error || result.status !== 0) throw result.error || new Error(`Bundled MCP dependency install failed (${result.status})`)
    await fs.rm(path.join(preparedRuntime, 'node_modules/.bin'), { recursive: true, force: true })
    for (const [source, target] of Object.entries(runtimePackage.mossRuntimeFiles || {})) {
      const input = path.join(preparedRuntime, ensureSafeRelativePath(source))
      const output = path.join(preparedRuntime, ensureSafeRelativePath(target))
      await fs.mkdir(path.dirname(output), { recursive: true })
      await fs.copyFile(input, output)
    }
  }
  if (python) await buildPythonBundle(root, preparedRuntime, manifest.platforms.length === 1 ? manifest.platforms[0] : `${process.platform}-${process.arch}`)
  const connectorDir = path.join(root, 'connector')
  const hasConnector = definition.connector && await fs.stat(connectorDir).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error })
  await generateToolApp({ definition, resourcesDir: hasResources ? resourcesDir : undefined, runtimeDir: preparedRuntime,
    connectorDir: hasConnector ? connectorDir : undefined, destination: output, readme })
  if (python) {
    await fs.writeFile(path.join(output, 'app.moss.json'), JSON.stringify({ ...manifest, platforms: [`${process.platform}-${process.arch}`] }, null, 2) + '\n')
    const { writePackageChecksums } = await import(pathToFileURL(path.join(coreRoot, 'packages/app-runtime/src/packages/index.mjs')))
    await writePackageChecksums(output)
  }
  } finally { if (preparedRuntime) await fs.rm(preparedRuntime, { recursive: true, force: true }) }
} finally {
  if (check) await fs.rm(output, { recursive: true, force: true })
}
