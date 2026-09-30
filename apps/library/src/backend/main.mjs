import { AppBackendClient } from '@moss/app-sdk'
import { fileURLToPath } from 'node:url'
import { createLibraryService } from './store.mjs'
import { parseLibraryResourceUri } from './resource-uri.mjs'
import { createActionLane, listResult } from './actions.mjs'

let ready = false
let service, python
const lane = createActionLane()
const backend = new AppBackendClient({
  async onInitialize(context) {
    python = await context.host.request('moss.runtimes/v1', 'python.get', {})
    service = createLibraryService({
      libraryRoot: context.dataDir,
      parserPath: fileURLToPath(new URL('./library_parser.py', import.meta.url)),
      pythonPath: python.available ? python.path : undefined,
      requireManagedRuntime: true,
      getPythonModulePaths: () => [fileURLToPath(new URL('./python/', import.meta.url))],
      getEngineStatus: () => ({ installed: python.available }),
      onChanged: data => { if (ready) backend.emit('library.changed', data) },
      log: (level, _area, message) => backend.log(level, message),
    })
    setImmediate(() => { ready = true })
  },
  async onShutdown() { ready = false; await lane.close(); service?.close(); await service?.waitForIdle() },
})
const methods = {
  'collections.list': 'listCollections', 'collections.create': 'createCollection',
  'collections.update': 'updateCollection', 'collections.delete': 'deleteCollection',
  'documents.list': 'listResources', 'documents.search': 'search', 'documents.read': 'readDocument',
  'documents.create': 'createDocument', 'documents.update': 'updateDocument', 'documents.delete': 'deleteDocument',
  'files.import': 'importFiles', 'sources.list': 'listSources', 'sources.refresh': 'refreshSource',
  'jobs.list': 'listJobs', 'jobs.cancel': 'cancelJob',
}
const mutations = new Set(['collections.create', 'collections.update', 'collections.delete', 'documents.create', 'documents.update', 'documents.delete', 'files.import', 'sources.refresh'])
for (const [action, method] of Object.entries(methods)) {
  backend.registerAction(action, async (input, context) => {
    const run = async (signal = context.signal) => {
      signal.throwIfAborted()
      const data = await service[method](input, { signal })
      if (action === 'files.import') {
        const written = listResult(data.written.slice(0, 100), {}, 128 * 1024).data
        const failed = listResult(data.failed.slice(0, 100), {}, 128 * 1024).data
        const jobs = listResult(data.jobs, {}, 128 * 1024).data
        return { data: { written, failed, jobs, writtenCount: data.written.length, failedCount: data.failed.length, jobsCount: data.jobs.length,
          truncated: written.length < data.written.length || failed.length < data.failed.length || jobs.length < data.jobs.length } }
      }
      if (action === 'sources.list') return listResult(data.map(({ config, ...source }) => source), input)
      if (Array.isArray(data)) {
        const result = listResult(data, input)
        if (action === 'documents.search' || action === 'jobs.list') delete result.nextOffset
        return result
      }
      return { data }
    }
    if (mutations.has(action) || action === 'documents.read') return lane.run(run, context.signal)
    return run()
  })
}
backend.registerAction('status.get', () => ({ data: { ...service.getOverview(), pythonAvailable: python.available } }))
backend.registerAction('local.pick', (input, context) => context.host.request('moss.local-files/v1', 'pick', input, { signal: context.signal, timeoutMs: 300000 }))
backend.registerAction('documents.open', async (input, context) => {
  const file = await lane.run(() => service.exportResource(input), context.signal)
  return context.host.request('moss.local-files/v1', input.reveal ? 'reveal' : 'open', { path: file.path }, { signal: context.signal })
})
backend.registerAction('resource.resolve', async ({ uri }, context) => {
  const reference = parseLibraryResourceUri(uri)
  if (!reference) throw new Error('无法识别文档引用。')
  return lane.run(() => service.exportResource(reference), context.signal)
})
backend.start()
