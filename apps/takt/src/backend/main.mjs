import { AppBackendClient } from '@moss/app-sdk'
import { Store } from './store.mjs'
import { Runs } from './runs.mjs'
import { parseDefinition } from '../engine/definition.mjs'
import { composerActions } from './composer.mjs'
import { definitionPresentation, runPresentation } from './presentation.mjs'
let store, runs
const backend = new AppBackendClient({
  onInitialize: context => { store = new Store(context.dataDir); runs = new Runs(store, backend.host, event => backend.emit('takt.changed', event)) },
  onShutdown: () => runs?.close(),
})
backend.registerAction('takt_read', input => {
  switch (input.operation) {
    case 'list': return store.list(input)
    case 'get': return definitionPresentation(store.revision(input.workflowId, input.revision))
    case 'runs': return store.list({ ...input, kind: 'runs' })
    case 'run': return runPresentation(store.detail(input.runId))
    case 'events': return store.events(input)
    case 'resource': return store.resource(input)
    case 'revisions': return store.revisions(input)
    default: throw new Error('未知读取操作')
  }
})
backend.registerAction('takt_create', input => { const result = store.create(input); backend.emit('takt.changed', { workflowId: result.id }); return definitionPresentation(result) })
backend.registerAction('takt_edit', input => { const result = store.edit(input); backend.emit('takt.changed', { workflowId: result.id }); return definitionPresentation(result) })
backend.registerAction('takt_validate', input => { const { raw, graph } = parseDefinition(input.yaml); return { valid: true, name: raw.name, graph, engineVersion: '0.70.0' } })
backend.registerAction('takt_run', async (input, context) => runPresentation(await runs.start(input, context.requestId)))
backend.registerAction('takt_control', (input, context) => {
  if (input.operation === 'cancel') return runs.cancel(input.runId)
  if (input.operation === 'pause') return runs.pause(input.runId)
  if (input.operation === 'resume') return runs.resume(input.runId)
  if (input.operation === 'input') return runs.addInput(input.runId, input.text)
  const run = store.getRun(input.runId)
  if (['running', 'submitting', 'paused', 'pausing'].includes(run.status)) throw new Error('请先停止当前运行')
  return runs.start({ workflowId: run.workflowId, revision: run.revision, task: input.task || run.task, submissionKey: input.submissionKey }, context.requestId)
})
backend.registerAction('takt_copy', input => { const source = store.revision(input.workflowId, input.revision); const result = store.create({ yaml: source.yaml, title: input.title || source.title + '（副本）' }); backend.emit('takt.changed', { workflowId: result.id }); return definitionPresentation(result) })
backend.registerAction('takt_archive', input => { const result = store.archive(input); backend.emit('takt.changed', { workflowId: input.workflowId }); return result })
for (const action of ['composer.list', 'composer.resolve']) backend.registerAction(action, input => composerActions(store)[action](input))
backend.start()
