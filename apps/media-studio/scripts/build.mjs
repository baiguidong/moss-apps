import { buildApp } from '@moss/engine-apps/build'
import { bundleAsset } from '@moss/engine-apps/bundle-build'
import { prepareBinary } from '@moss/engine-apps/download'
import { bundleNativeDependencies } from '@moss/local-tasks/build'
import { bundleDependencies } from '@moss/media-engines/bundle'
import model from '@moss/media-engines/model' with { type: 'json' }
import melo from '../resources/melo.json' with { type: 'json' }
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const cache = process.env.MOSS_BUILD_DEPENDENCY_CACHE || path.join(os.homedir(), '.cache/moss-apps-build')
const linux = process.platform === 'linux'
const external = ['@fugood/whisper.node', 'sharp', 'hyperframes', 'sherpa-onnx-node']

function execute(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed`)
}

function worker(source, name) {
  execute('bun', ['build', source, '--target=node', '--format=esm', ...external.map(pkg => '--external=' + pkg), `--outfile=dist/backend/${name}.mjs`])
}

await buildApp(root, { external, assetBundleOptions: { threshold: 48 * 1024 ** 2 } })
worker('src/backend/image/worker.mjs', 'image-worker')
bundleNativeDependencies(root, ['@fugood/whisper.node', 'sharp', ...(linux ? ['sherpa-onnx-node'] : [])])
bundleDependencies('hyperframes', path.join(root, 'dist/backend'), createRequire(import.meta.url))
await bundleAsset(await prepareBinary(model, cache), path.join(root, 'dist/models', model.executable), model.binarySha256)

if (linux) {
  worker('src/backend/voice-worker.mjs', 'voice-worker')
  const archive = await prepareBinary(melo, cache)
  const assets = path.join(root, 'dist/voices/melo-zh')
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-melo-'))
  try {
    const files = ['LICENSE', 'model.onnx', 'lexicon.txt', 'tokens.txt', 'date.fst', 'number.fst', 'phone.fst']
    execute('tar', ['-xjf', archive, '-C', temporary, '--strip-components=1', ...files.map(file => melo.member + '/' + file)])
    await fs.mkdir(assets, { recursive: true })
    for (const file of files.filter(file => file !== 'model.onnx')) await fs.copyFile(path.join(temporary, file), path.join(assets, file))
    await bundleAsset(path.join(temporary, 'model.onnx'), path.join(assets, 'model.onnx'), melo.modelSha256)
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}
