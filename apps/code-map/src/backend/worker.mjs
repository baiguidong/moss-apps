import { TaskStore, executeTask } from '@moss/engine-apps/runtime'
import engine from './engine.mjs'
for await (const _chunk of process.stdin) {}
const store = new TaskStore(process.argv[2])
await executeTask(engine, store, await store.get(process.argv[3]))
await engine.close?.()
