import { TaskStore, WORKER_PROGRESS_MESSAGE, executeTask, waitForWorkerStart } from '@moss/engine-apps/runtime'
import engine from './file-management.mjs'
const parentSignal = await waitForWorkerStart()
const store = new TaskStore(process.argv[2])
await executeTask(engine, store, await store.get(process.argv[3]), parentSignal, () => {
  if (process.connected) process.send({ type: WORKER_PROGRESS_MESSAGE }, () => {})
})
await engine.close?.()
