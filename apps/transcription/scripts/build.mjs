import { buildApp } from '@moss/local-tasks/build'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { bundleAsset } from '@moss/engine-apps/bundle-build'
import { prepareBinary } from '@moss/engine-apps/download'
import { platformAsset } from '@moss/engine-apps/platform'
import model from '../resources/model.json' with {type:'json'}
import ffmpeg from '../resources/ffmpeg.json' with {type:'json'}
const cache = process.env.MOSS_BUILD_DEPENDENCY_CACHE || path.join(os.homedir(), '.cache/moss-apps-build')
const ffmpegSpec = platformAsset(ffmpeg)
const binary = await prepareBinary(ffmpegSpec, cache)
fs.chmodSync(binary, 0o755)
const version = spawnSync(binary, ['-version'], { encoding: 'utf8' })
if (version.status || version.error) throw version.error || new Error('FFmpeg cannot run on this build platform')
if (version.stdout.includes('--enable-nonfree')) throw new Error('Do not package a non-redistributable FFmpeg build')
buildApp(fileURLToPath(new URL('..', import.meta.url)), ["@fugood/whisper.node"])
await bundleAsset(binary, fileURLToPath(new URL(`../dist/engines/${ffmpegSpec.id}/${ffmpegSpec.version}/${ffmpegSpec.executable}`, import.meta.url)), ffmpegSpec.binarySha256)
const source = await prepareBinary(model, cache)
const target = fileURLToPath(new URL('../dist/models/' + model.executable, import.meta.url))
await bundleAsset(source, target, model.binarySha256)
console.log(`Bundled Whisper base model (${model.binarySha256})`)
