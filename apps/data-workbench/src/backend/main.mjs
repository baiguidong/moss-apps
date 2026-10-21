import { startBackend } from '@moss/engine-apps/backend'
import { fileURLToPath } from 'node:url'
import engine from './engine.mjs'
startBackend(engine, fileURLToPath(new URL('worker.mjs', import.meta.url)))
