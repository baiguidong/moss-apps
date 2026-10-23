import { AppBackendClient } from '@moss/app-sdk'
import { fileURLToPath } from 'node:url'
import { KnowledgeService } from './service.mjs'

let service
const backend = new AppBackendClient({
  async onInitialize(context) {
    service = new KnowledgeService({ dataDir: context.dataDir,
      resourcesDir: fileURLToPath(new URL('../../resources/', import.meta.url)),
      getPython: signal => context.host.request('moss.runtimes/v1', 'python.get', {}, { signal, timeoutMs: 30000 }),
      register: async (config, signal) => {
        const { servers } = await context.host.request('moss.mcp/v1', 'servers.list', {}, { signal, timeoutMs: 30000 })
        const previous = servers.find(server => server.name === 'knowledge')
        return context.host.request('moss.mcp/v1', 'servers.save', {
          name: 'knowledge', ...(previous ? { previousName: previous.name } : {}), enabled: previous?.enabled ?? true, config,
        }, { signal, timeoutMs: 30000 })
      },
      onChanged: data => backend.emit('knowledge.changed', data),
    })
    setImmediate(() => service.initialize().catch(error => service.change('failed', '', error.message)))
  },
  async onShutdown() { await service?.close() },
})
backend.registerAction('engine.status', (_input, context) => service.overview(context))
backend.registerAction('engine.prepare', () => service.begin('install'))
backend.registerAction('engine.start', async () => {
  service.begin('start')
  await service.operation
  return service.status()
})
backend.registerAction('engine.cancel', () => service.cancelPreparation())
backend.registerAction('documents.list', (input, context) => service.list(input, context))
backend.registerAction('documents.search', (input, context) => service.search(input, context))
backend.registerAction('documents.read', (input, context) => service.read(input, context))
backend.registerAction('files.pick', (_input, context) => context.host.request('moss.local-files/v1', 'pick', { kind: 'file', multiple: true }, { signal: context.signal }))
backend.registerAction('files.import', (input, context) => service.importFiles(input, context))
backend.registerAction('index.rebuild', (_input, context) => service.call('reindex_documents', { force: true }, context))
backend.start()
