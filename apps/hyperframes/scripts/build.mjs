import { buildApp } from '@moss/engine-apps/build'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'
import { bundleDependencies } from './bundle-dependencies.mjs'
import { verifyBundle } from './verify-bundle.mjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
await buildApp(root)
const count = bundleDependencies('hyperframes', path.join(root, 'dist/backend'), require)
console.log(`Bundled HyperFrames and ${count - 1} production dependencies`)
await verifyBundle(root)
