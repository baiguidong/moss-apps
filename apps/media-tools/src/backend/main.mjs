import { startBackend } from '@moss/engine-apps/backend'
import { fileURLToPath } from 'node:url'
import engine from './engine.mjs'
import { registerStudio } from './studio.mjs'

let studio
const workshop = {
  ...engine,
  register(backend, ctx) {
    return (studio ??= registerStudio(backend, ctx))
  },
  async close() {
    const close = await studio
    await close?.()
  },
}
startBackend(workshop, fileURLToPath(new URL('worker.mjs', import.meta.url)))
