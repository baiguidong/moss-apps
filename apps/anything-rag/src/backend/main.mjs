import { AppBackendClient } from '@moss/app-sdk'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RagService } from './service.mjs'
import { createPdfOcr } from './pdf-ocr.mjs'

let service
let pythonPreparation
const backend = new AppBackendClient({
  async onInitialize(context) {
    const getPython = signal => pythonPreparation ??= context.host.request('moss.runtimes/v1', 'python.get', {}, { signal })
      .then(result => result)
      .catch(error => { pythonPreparation = undefined; throw error })
    service = new RagService({ dataDir: context.dataDir, bundledModelDir: fileURLToPath(new URL('./models/', import.meta.url)), disableNative: existsSync(`${context.dataDir}/.disable-native`), getPython, pdfParserPath: fileURLToPath(new URL('./pdf_parser.py', import.meta.url)), pdfModulePath: fileURLToPath(new URL('./python/', import.meta.url)), recognizePdf: createPdfOcr(context.host), onChanged: value => backend.emit('rag.changed', value) })
    await service.initialize()
  },
  async onShutdown() { await service?.close() },
})
const register = (name, fn) => backend.registerAction(name, (input, context) => fn(input || {}, context || {}))
register('engine.status', () => service.status())
register('engine.prepare', () => service.prepare())
register('engine.retry', () => service.retryPrepare())
register('engine.cancel', (_input, context) => service.cancel(context))
register('spaces.list', () => service.listSpaces())
register('spaces.create', input => service.createSpace(input))
register('spaces.update', input => service.updateSpace(input))
register('spaces.delete', input => service.deleteSpace(input))
register('documents.list', input => service.listDocuments(input))
register('documents.read', input => service.readDocument(input))
register('documents.search', (input, context) => service.search(input, context))
register('documents.delete', input => service.deleteDocument(input))
register('files.pick', (input, context) => context.host.request('moss.local-files/v1', 'pick', { kind: 'file', multiple: input.multiple !== false }, { signal: context.signal, timeoutMs: 300000 }))
register('files.import', (input, context) => service.importFiles(input, context))
register('index.rebuild', (_input, context) => service.rebuild(context))
register('jobs.list', () => service.listJobs())
register('settings.get', () => service.getSettings())
register('settings.update', input => service.updateSettings(input))
register('resource.resolve', input => service.resolveResource(input))
backend.start()
