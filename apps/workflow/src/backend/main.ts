import { AppBackendClient, compileJsonSchema } from '@moss/app-sdk'
import fs from 'node:fs'
import path from 'node:path'
import * as catalog from '../engine/catalog'
import { withCatalogContext } from '../storage/context'
import { RunManager } from './runs'
import { validateDefinition, resolveChildren } from './validation'
import { Resources } from './resources'
import { composerActions } from './composer'
import { randomUUID } from 'node:crypto'
let dataDir = '',
  resources: Resources,
  runs: RunManager
const backend = new AppBackendClient({
  onInitialize: async (context) => {
    dataDir = context.dataDir
    resources = new Resources(path.join(dataDir, 'resources'))
    runs = new RunManager(path.join(dataDir, 'runs'), backend.host, (event) =>
      backend.emit('workflow.changed', event),
    )
  },
  onShutdown: async () => {
    await runs?.close()
  },
})
const validators = new Map<string, any>()
const actions: Record<string, (input: any) => any> = {
  ...composerActions,
  'catalog.list': (input) => catalog.listWorkflowCatalog(input),
  'catalog.get': (input) => catalog.getWorkflowCatalogDetail(input),
  'catalog.create': async (input) => { validateDefinition(input.definition); await resolveChildren(input.definition, input.cwd); return catalog.createWorkflowDraft(input) },
  'catalog.edit': async (input) => { validateDefinition(input.definition); await resolveChildren(input.definition, input.cwd, input.workflowId); return catalog.updateWorkflowDraft(input) },
  'catalog.publish': async (input) => { const detail = await catalog.getWorkflowCatalogDetail(input); validateDefinition(detail.revision.definition); await resolveChildren(detail.revision.definition, input.cwd, input.workflowId); return catalog.publishWorkflow(input) },
  'catalog.unpublish': (input) => catalog.unpublishWorkflow(input),
  'catalog.archive': (input) => catalog.archiveWorkflow(input),
  'catalog.restore': (input) => catalog.restoreWorkflow(input),
  'catalog.duplicate': (input) => catalog.duplicateWorkflow(input),
  'catalog.delete': (input) => catalog.deleteWorkflow(input),
  'run.start': (input) => runs.start(input),
  'run.list': (input) => runs.list(input),
  'resource.read': (input) => { try { return resources.read(input) } catch { return runs.resources.read(input) } },
  'run.get': (input) => {
    const run = runs.get(input.runId)
    return {
      ...runs.summary(run),
      definition: resources.bound(run.definition, 128_000),
      args: resources.bound(run.args),
      snapshot: runs.snapshot(run),
      events: run.events.slice(-Math.max(1, Math.min(input.limit ?? 10, 10))),
    }
  },
  'run.export': (input) => { const {submissionKey, fingerprint,taskInput,...run}=runs.get(input.runId); return run },
  'run.events': (input) => runs.events(input),
  'run.cancel': (input) => runs.cancel(input.runId),
  'run.resume': (input) => runs.resume(input.runId),

}
const groups: Record<string, Record<string,string>> = {
  workflow_read: {list:'catalog.list',get:'catalog.get',runs:'run.list',run:'run.get',events:'run.events',export:'run.export',resource:'resource.read'},
  workflow_manage: {publish:'catalog.publish',duplicate:'catalog.duplicate',restore:'catalog.restore'},
  workflow_run: {start:'run.start',cancel:'run.cancel',resume:'run.resume'},
  workflow_remove: {unpublish:'catalog.unpublish',archive:'catalog.archive',delete:'catalog.delete'},
}
for (const name of [...Object.keys(actions), ...Object.keys(groups)])
  backend.registerAction(name, (raw: any, context: any) => {
    const {operation, ...input} = raw
    const actionName = groups[name]?.[operation] ?? name
    if (!actions[actionName] || (groups[name] && !groups[name][operation])) throw new Error('Unknown workflow operation')
    if (groups[name]) {
      if (!validators.has(actionName)) validators.set(actionName, compileJsonSchema(JSON.parse(fs.readFileSync(new URL('../../schemas/' + actionName + '.json', import.meta.url),'utf8'))))
      const validate = validators.get(actionName)
      if (!validate(input)) throw new Error('Invalid input for ' + operation + ': ' + JSON.stringify(validate.errors))
    }
    // Tool workspace is Host-attested. An App window may explicitly choose a directory.
    input.cwd = context.source?.workspace ?? input.cwd
    if (input.scope === 'project' && !input.cwd) throw new Error('项目工作流需要选择项目目录')
    if (actionName === 'run.start') input.submissionKey ??= context.requestId || randomUUID()
    return withCatalogContext({ dataDir, cwd: input.cwd }, async () => {
      let result = await actions[actionName](input)
      if (result?.record && result?.revision) result.presentation = { title: result.record.title, route: `#/flow/definitions/${result.record.id}?revision=${result.revision.revision}` };
      if (actionName === 'catalog.list') result = result.map(({graph,mermaid,...entry}: any) => entry)
      if (actionName.startsWith('catalog.') && !['catalog.list', 'catalog.get'].includes(actionName)) backend.emit('workflow.changed', { action: actionName })
      // Every response is bounded even for unusually large definitions/history.
      if (Array.isArray(result)) return (['run.list','commands.list','composer.list'].includes(actionName) ? result : result.slice(input.offset ?? 0, (input.offset ?? 0) + Math.min(input.limit ?? 20,20))).map(value => resources.bound(value))
      return resources.bound(result, 384_000)
    })
  })
backend.start()
