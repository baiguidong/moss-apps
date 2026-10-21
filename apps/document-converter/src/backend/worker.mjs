import { TaskStore, executeTask, waitForWorkerStart } from '@moss/engine-apps/runtime'
import engine from './engine.mjs'
const parentSignal = await waitForWorkerStart()
const store = new TaskStore(process.argv[2])
await executeTask(engine, store, await store.get(process.argv[3]), parentSignal)
await engine.close?.()
