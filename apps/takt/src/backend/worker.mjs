import { parentPort, workerData } from 'node:worker_threads'
import { executeWorkflow } from '../engine/execute.mjs'
const controller = new AbortController(), pending = new Map()
let addInput
let sequence = 0
parentPort.on('message', message => {
  if (message.type === 'cancel') controller.abort(new Error('运行已取消'))
  if (message.type === 'input') addInput?.(message.text)
  if (message.type === 'result') {
    const request = pending.get(message.id); pending.delete(message.id)
    if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message.result)
  }
})
const callHost = (input, signal) => new Promise((resolve, reject) => {
  signal?.throwIfAborted()
  const id = String(++sequence)
  const abort = () => { pending.delete(id); parentPort.postMessage({ type: 'cancel-call', id }); reject(signal.reason) }
  signal?.addEventListener('abort', abort, { once: true })
  const cleanup = fn => value => { signal?.removeEventListener('abort', abort); fn(value) }
  pending.set(id, { resolve: cleanup(resolve), reject: cleanup(reject) })
  parentPort.postMessage({ type: 'call', id, input })
})
executeWorkflow({ ...workerData, signal: controller.signal, callHost, onReady: engine => { addInput = text => engine.addUserInput(text) }, onEvent: event => parentPort.postMessage({ type: 'event', event }) })
  .then(outcome => parentPort.postMessage({ type: 'outcome', outcome }), error => parentPort.postMessage({ type: 'outcome', outcome: { status: controller.signal.aborted ? 'cancelled' : 'failed', error: error.message } }))
  .finally(() => parentPort.close())
