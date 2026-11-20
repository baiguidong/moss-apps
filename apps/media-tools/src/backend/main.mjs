import { startBackend } from '@moss/engine-apps/backend'
import { fileURLToPath } from 'node:url'
import engine from './workshop-engine.mjs'
import { registerWorkshop } from './workshop.mjs'

let registration
startBackend({
  ...engine,
  register(backend, context, tasks) {
    return registration ??= registerWorkshop(backend, context, tasks)
  },
  async close() { await (await registration)?.() },
}, fileURLToPath(new URL('worker.mjs', import.meta.url)))
