import { buildApp } from '@moss/engine-apps/build'
import { bundleAsset } from '@moss/engine-apps/bundle-build'
import { prepareBinary } from '@moss/engine-apps/download'
import { bundleNativeDependencies } from '@moss/local-tasks/build'
import { bundleDependencies } from '@moss/media-engines/bundle'
import model from '@moss/media-engines/model' with { type: 'json' }
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
await buildApp(root, { external: ['@fugood/whisper.node', 'hyperframes'] })
bundleNativeDependencies(root, ['@fugood/whisper.node'])
bundleDependencies('hyperframes', path.join(root, 'dist/backend'), createRequire(import.meta.url))
const cache = process.env.MOSS_BUILD_DEPENDENCY_CACHE || path.join(os.homedir(), '.cache/moss-apps-build')
await bundleAsset(await prepareBinary(model, cache), path.join(root, 'dist/models', model.executable), model.binarySha256)
