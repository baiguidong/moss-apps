import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const repo = path.resolve(appRoot, '../..')
const version = JSON.parse(await fs.readFile(path.join(appRoot, 'app.moss.json'), 'utf8')).version
const artifactRoot = path.join(repo, 'artifacts/moss.anything-rag', version)
const targets = process.argv.slice(2).length ? process.argv.slice(2) : [`${process.platform}-${process.arch}`]
const results = []

for (const target of targets) {
  const packageRoot = path.join(artifactRoot, `package-${target}`)
  const modules = path.join(packageRoot, 'dist/backend/node_modules')
  const sharpPackage = path.join(modules, 'sharp/package.json')
  const transformersPackage = path.join(modules, '@xenova/transformers/package.json')
  const onnxPackage = path.join(modules, 'onnxruntime-node/package.json')
  if (![sharpPackage, transformersPackage, onnxPackage].every(file => fsSync.existsSync(file))) throw new Error(`${target}: bundled runtime package is incomplete`)
  const bundledModel = path.join(packageRoot, 'dist/backend/models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx')
  if (!fsSync.existsSync(bundledModel)) throw new Error(`${target}: bundled embedding model is missing`)
  const sharp = JSON.parse(await fs.readFile(sharpPackage, 'utf8'))
  const nativeFiles = []
  const walk = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (/\.(node|dylib|so|dll)$/.test(entry.name)) nativeFiles.push(path.relative(packageRoot, file))
    }
  }
  await walk(modules)
  const hostTarget = `${process.platform}-${process.arch}`
  let sharpLoaded = false
  let onnxLoaded = false
  if (target === hostTarget) {
    const requireFromModules = createRequire(path.join(modules, 'package.json'))
    const sharpModule = requireFromModules('sharp')
    const onnxModule = requireFromModules('onnxruntime-node')
    const transformerEntry = JSON.parse(await fs.readFile(transformersPackage, 'utf8')).main
    await import(pathToFileURL(path.join(modules, '@xenova/transformers', transformerEntry)).href)
    sharpLoaded = Boolean(sharpModule.versions?.sharp)
    onnxLoaded = Boolean(onnxModule.InferenceSession)
  }
  const check = {
    target,
    sharpVersion: sharp.version,
    sharpLoaded,
    onnxLoaded,
    bundledModel: true,
    bundledModelBytes: fsSync.statSync(bundledModel).size,
    nativeFiles: nativeFiles.filter(file => file.includes('sharp-') || file.includes('onnxruntime')).sort(),
  }
  const [targetOs, targetArch] = target.split('-')
  const targetSharp = check.nativeFiles.some(file => file.includes(`@img/sharp-${target}/`))
  const targetOnnx = check.nativeFiles.some(file => file.includes(`/onnxruntime-node/bin/napi-v3/${targetOs}/${targetArch}/`))
  if (!targetSharp || !targetOnnx || (target === hostTarget && (!check.sharpLoaded || !check.onnxLoaded))) throw new Error(`${target}: native runtime smoke failed: ${JSON.stringify(check)}`)
  results.push(check)
}

const output = path.join(repo, 'artifacts/moss.anything-rag/native-package-verification.json')
await fs.writeFile(output, JSON.stringify({ status: 'passed', at: new Date().toISOString(), results }, null, 2) + '\n')
console.log(JSON.stringify({ status: 'passed', output, results }, null, 2))
