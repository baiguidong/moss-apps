import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { TaskStore, executeTask } from '@moss/engine-apps/runtime'
export async function fixture(t, engine) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-creation-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new TaskStore(root)
  const actions = new Map()
  await engine.register({ registerAction: (name, fn) => actions.set(name, fn) }, { dataDir: root })
  return { root, store, actions, async run(input, success = true) {
    const task = await store.create(input)
    await executeTask(engine, store, task)
    const result = await store.get(task.id)
    assert.equal(result.status, success ? 'succeeded' : 'failed', result.message)
    return result
  } }
}
