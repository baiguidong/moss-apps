import { parentPort, workerData } from 'node:worker_threads'
import {
  executeWorkflowDefinition,
  prepareWorkflowDefinition,
} from '../engine/runtime'
import { createWorkflowSharedCounters } from '../engine/harness'
import { WorkflowJournal } from '../engine/journal'
const port = parentPort!
const controller = new AbortController()
const pending = new Map<
  string,
  { resolve: (value: any) => void; reject: (error: Error) => void; params: any }
>()
let sequence = 0
port.on('message', (message) => {
  if (message.type === 'cancel') controller.abort(new Error('用户停止运行'))
  if (message.type === 'agent-progress') {
    const call = pending.get(message.id)
    call?.params.onAgentId(message.progress.agentId)
    call?.params.onProgress(message.progress)
  }
  if (message.type === 'agent-result') {
    const call = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) call?.reject(new Error(message.error))
    else call?.resolve(message.result)
  }
})
const runAgentImpl = (params: any) =>
  new Promise<any>((resolve, reject) => {
    const id = String(++sequence)
    pending.set(id, { resolve, reject, params })
    const cancel = () => {
      port.postMessage({ type: 'agent-cancel', id })
      pending.delete(id)
      reject(new Error('Agent cancelled'))
    }
    params.abortController.signal.addEventListener('abort', cancel, {
      once: true,
    })
    port.postMessage({
      type: 'agent',
      id,
      input: {
        prompt: params.prompt,
        opts: params.opts,
        contextKey: params.contextKey,
        idempotencyKey: params.idempotencyKey,
      },
    })
  }).then((result) => {
    params.onAgentId(result.agentId)
    params.onProgress(result)
    return result
  })
const shared = createWorkflowSharedCounters(
  workerData.definition.limits?.maxConcurrency ??
    workerData.definition.defaults?.concurrency ??
    4,
  workerData.definition.limits?.maxAgentCalls,
)
async function execute(
  definition: any,
  args: unknown,
  prefix = '',
  depth = 0,
): Promise<any> {
  const prepared = prepareWorkflowDefinition(definition)
  if (!prepared.ok) throw new Error(prepared.error)
  const journal = new WorkflowJournal(
    workerData.journal +
      (prefix ? '.' + Buffer.from(prefix).toString('hex') : ''),
  )
  try {
    return await executeWorkflowDefinition({
      prepared,
      runId: workerData.runId,
      args,
      signal: controller.signal,
      journal,
      journalSnapshot: await journal.load(),
      instancePrefix: prefix,
      shared,
      runAgentImpl,
      onAgentController: () => {},
      onProgress: (event) => port.postMessage({ type: 'event', event: { ...event, workflowDepth: depth } }),
      runNestedWorkflow: async (ref, input, instanceId) => {
        if (depth > 0) throw new Error('只支持一层子工作流')
        const nested = workerData.nested[JSON.stringify(ref)]
        if (!nested) throw new Error('子工作流未锁定到本次运行快照')
        const outcome = await execute(nested, input, instanceId, depth + 1)
        if (outcome.status !== 'completed')
          throw new Error(outcome.error || '子工作流未完成')
        return outcome.result
      },
    })
  } finally {
    await journal.flush()
  }
}
execute(workerData.definition, workerData.args)
  .then(
    (outcome) => port.postMessage({ type: 'outcome', outcome }),
    (error) =>
      port.postMessage({
        type: 'outcome',
        outcome: { status: 'failed', error: error.message },
      }),
  )
  .finally(() => port.close())
