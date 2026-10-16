import { buildApp } from '@moss/local-tasks/build'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { bundleAsset } from '@moss/engine-apps/bundle-build'
import { prepareBinary } from '@moss/engine-apps/download'
import model from '../resources/model.json' with {type:'json'}
const require = createRequire(import.meta.url)
const binary = path.join(path.dirname(require.resolve('@drbearzay/ffmpeg-darwin-arm64/package.json')), 'ffmpeg')
fs.chmodSync(binary, 0o755)
const version = spawnSync(binary, ['-version'], { encoding: 'utf8' })
if (version.status || version.error) throw version.error || new Error('FFmpeg cannot run on this build platform')
if (version.stdout.includes('--enable-nonfree')) throw new Error('Do not package a non-redistributable FFmpeg build')
buildApp(fileURLToPath(new URL('..', import.meta.url)), ["@fugood/whisper.node", "@drbearzay/ffmpeg-darwin-arm64"])
const cache = process.env.MOSS_BUILD_DEPENDENCY_CACHE || path.join(os.homedir(), '.cache/moss-apps-build')
const source = await prepareBinary(model, cache)
const target = fileURLToPath(new URL('../dist/models/' + model.executable, import.meta.url))
await bundleAsset(source, target, model.binarySha256)
console.log(`Bundled Whisper base model (${model.binarySha256})`)
