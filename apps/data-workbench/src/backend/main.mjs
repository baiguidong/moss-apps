import { startBackend } from '@moss/engine-apps/backend'
import { fileURLToPath } from 'node:url'
import engine from './engine.mjs'
import { registerDatasetActions } from './dataset.mjs'
const backend = startBackend(engine, fileURLToPath(new URL('worker.mjs', import.meta.url)))
registerDatasetActions(backend)
