import { buildAppSettings } from '@moss/app-settings/build'
import { unzipSync } from 'fflate'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const cwd = fileURLToPath(new URL('..', import.meta.url))
for (const [command, args] of [
  ['vite', ['build']],
  ['bun', ['build', 'src/backend/main.mjs', '--target=node', '--format=esm', '--external=@xenova/transformers', '--outfile=dist/backend/main.mjs']],
]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Transformers.js imports sharp and ONNX Runtime as Node packages. Keep these
// runtime packages outside the JS bundle so their platform-specific native
// assets can travel in the App package. The direct sharp dependency pins the
// maintained 0.34 prebuilt layout; when transformers asks for its older
// sharp range, intentionally resolve the App's direct package instead.
const require = createRequire(new URL('../package.json', import.meta.url))
const backendModules = fileURLToPath(new URL('../dist/backend/node_modules/', import.meta.url))
fs.rmSync(backendModules, { recursive: true, force: true })
fs.mkdirSync(backendModules, { recursive: true })
fs.copyFileSync(path.join(cwd, 'src/backend/pdf_parser.py'), path.join(cwd, 'dist/backend/pdf_parser.py'))
const pythonModules = path.join(cwd, 'dist/backend/python')
fs.rmSync(pythonModules, { recursive: true, force: true })
fs.mkdirSync(pythonModules, { recursive: true })
const pypdfWheel = path.join(cwd, 'resources/pypdf-6.1.1-py3-none-any.whl')
const pypdfFiles = unzipSync(fs.readFileSync(pypdfWheel))
for (const [name, bytes] of Object.entries(pypdfFiles)) {
  if (!name.startsWith('pypdf/') || name.endsWith('/')) continue
  const destination = path.join(pythonModules, name)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, bytes)
}
console.log(`Bundled managed Python PDF parser pypdf@6.1.1`)
const copied = new Map()
const platform = `${process.platform}-${process.arch}`
function compatible(pkg) {
  const [os, cpu] = platform.split('-')
  return (!pkg.os || pkg.os.includes(os)) && (!pkg.cpu || pkg.cpu.includes(cpu))
}
function copyPackage(name, resolver) {
  const packageName = name === 'sharp' ? 'sharp' : name
  let packageJson
  try { packageJson = resolver.resolve(`${packageName}/package.json`) } catch {
    packageJson = (resolver.resolve.paths(packageName) || []).map(directory => path.join(directory, packageName, 'package.json')).find(file => fs.existsSync(file))
    if (!packageJson) {
      let entry = resolver.resolve(packageName)
      while (entry !== path.dirname(entry) && !fs.existsSync(path.join(entry, 'package.json'))) entry = path.dirname(entry)
      packageJson = path.join(entry, 'package.json')
    }
  }
  const source = fs.realpathSync(path.dirname(packageJson))
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
  if (!compatible(pkg)) return
  if (copied.has(packageName)) {
    if (copied.get(packageName) !== pkg.version) throw new Error(`Conflicting runtime versions for ${packageName}: ${copied.get(packageName)} and ${pkg.version}`)
    return
  }
  copied.set(packageName, pkg.version)
  fs.cpSync(source, path.join(backendModules, packageName), { recursive: true, dereference: true, filter: file => path.basename(file) !== 'node_modules' && path.basename(file) !== '.git' })
  const nested = createRequire(path.join(source, 'package.json'))
  for (const dep of Object.keys(pkg.dependencies || {})) copyPackage(dep, dep === 'sharp' ? require : nested)
  for (const dep of Object.keys(pkg.optionalDependencies || {})) {
    try { copyPackage(dep, dep === 'sharp' ? require : nested) } catch (error) { if (!/Cannot find module/.test(error.message)) throw error }
  }
}
copyPackage('@xenova/transformers', require)
copyPackage('sharp', require)
console.log(`Bundled embedding runtime packages: ${[...copied].map(([name, version]) => `${name}@${version}`).join(', ')}`)

// The fixed model is kept as source chunks so the rebuildable source package
// stays within its per-file limit. Reassemble it into the runtime Backend
// directory; the published App therefore works offline on first launch.
const modelPartsRoot = fileURLToPath(new URL('../model-parts/', import.meta.url))
const modelManifest = JSON.parse(fs.readFileSync(path.join(modelPartsRoot, 'Xenova/multilingual-e5-small/manifest.json'), 'utf8'))
const modelSourceRoot = path.join(modelPartsRoot, 'Xenova/multilingual-e5-small')
const modelRuntimeRoot = path.join(cwd, 'dist/backend/models/Xenova/multilingual-e5-small')
fs.rmSync(modelRuntimeRoot, { recursive: true, force: true })
fs.mkdirSync(path.join(modelRuntimeRoot, 'onnx'), { recursive: true })
for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json']) {
  fs.copyFileSync(path.join(modelSourceRoot, file), path.join(modelRuntimeRoot, file))
}
const modelBytes = Buffer.concat(modelManifest.parts.map(file => fs.readFileSync(path.join(modelSourceRoot, file))))
const modelHash = createHash('sha256').update(modelBytes).digest('hex')
if (modelBytes.length !== modelManifest.onnxBytes || modelHash !== modelManifest.onnxSha256) throw new Error('Bundled embedding model checksum mismatch')
fs.writeFileSync(path.join(modelRuntimeRoot, modelManifest.onnx), modelBytes)
console.log(`Bundled embedding model ${modelManifest.model}@${modelManifest.revision} (${modelBytes.length} bytes)`)

await buildAppSettings(fileURLToPath(new URL('..', import.meta.url)))
