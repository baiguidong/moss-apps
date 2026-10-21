import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LocalTasks } from '@moss/local-tasks/backend'

test('on-demand task registers work until its worker exits and returns Host artifact URLs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-pdf-lifecycle-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const worker = path.join(root, 'worker.cjs')
  await fs.writeFile(worker, "process.on('message', () => setTimeout(() => process.send({type:'result',result:{files:[]}}), 50))")
  const source = path.join(root, 'input.txt')
  await fs.writeFile(source, 'sample')
  const activity = []
  const service = await new LocalTasks({ dataDir: path.join(root, 'data'), worker,
    inspect: async () => ({ kind: 'text' }), validate: () => ({ fileIds: [], title: 'Sample' }),
    activity: async (operation, id) => { activity.push([operation, id]); return { active: operation !== 'end' } },
    artifactUrl: async relative => `host://artifact/${relative}`,
  }).initialize()
  t.after(() => service.close())
  const imported = await service.importFiles([source])
  assert.match(imported.files[0].url, /^host:\/\/artifact\/files\//)
  assert.equal((await service.overview()).files[0].url, imported.files[0].url)
  const task = await service.start({})
  assert.deepEqual(activity[0], ['begin', task.id])
  for (let i = 0; i < 100 && !activity.some(([op, id]) => op === 'end' && id === task.id); i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(activity.some(([op, id]) => op === 'end' && id === task.id))
  assert.equal((await service.overview()).tasks[0].status, 'succeeded')
})
