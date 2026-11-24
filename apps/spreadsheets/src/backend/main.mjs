import { startBackend } from '@moss/engine-apps/backend'
import { fileURLToPath } from 'node:url'
import engine from './engine.mjs'
startBackend(engine, fileURLToPath(new URL('worker.mjs', import.meta.url)), {
  sessionScoped: true,
  workbenchActions: ['editor.start', 'editor.open', 'editor.cells', 'editor.status', 'editor.save', 'editor.history', 'editor.export'],
})
