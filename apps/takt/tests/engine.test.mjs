import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeWorkflow, parseDefinition, Store, Runs } from '../dist/tests/api.mjs'
import { composerActions } from '../src/backend/composer.mjs'
import { definitionPresentation } from '../src/backend/presentation.mjs'
const example = fs.readFileSync(new URL('../resources/example.yaml', import.meta.url), 'utf8')
const single = 'name: simple\nmax_steps: 4\nsteps:\n  - name: first\n    instruction: Reply with hello\n    rules:\n      - condition: done\n        next: COMPLETE\n'
const fixture = async work => { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'takt-test-')); try { return await work(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) } }
test('failed task submission is persisted and restart retires unfinished submissions', () => fixture(async directory => {
  const store = new Store(directory), flow = store.create({ yaml: single, title: '提交失败验证' })
  const host = { request: async (_protocol, method) => {
    if (method === 'task.create') throw new Error('App runtime generation is stale')
    return { items: [], cursor: 0 }
  }, on: () => () => {} }
  const changes = [], runs = new Runs(store, host, event => changes.push(event))
  try {
    await assert.rejects(runs.start({ workflowId: flow.id, revision: 1, task: '验证', submissionKey: 'failed-submit' }, 'request'), /stale/)
    const failed = [...store.runs.values()][0]
    assert.equal(failed.status, 'failed'); assert.ok(failed.endedAt); assert.equal(failed.occurrences.length, 0)
    assert.ok(new Store(directory).getRun(failed.id).error.includes('提交失败'))
    assert.equal(changes.at(-1).runId, failed.id)
    failed.status = 'submitting'; delete failed.endedAt; store.saveRun(failed)
  } finally { await runs.close() }
  const restored = new Store(directory), restarted = new Runs(restored, host, () => {})
  try { assert.equal([...restored.runs.values()][0].status, 'interrupted') }
  finally { await restarted.close() }
}))
test('conversation previews pin revisions and node discussion validates the run and occurrence', () => fixture(async directory => {
  const store = new Store(directory), flow = store.create({ yaml: single, title: '讨论验证' })
  const preview = definitionPresentation(flow)
  assert.equal(preview.presentation.route, `#/flows/${flow.id}?revision=1`)
  const ref = { workflowId: flow.id, revision: 1, runId: 'run_test', nodeId: 'first', occurrenceId: 'first:2' }
  store.saveRun({ id: ref.runId, workflowId: flow.id, revision: 1, graph: flow.graph, occurrences: [{ id: 'first:2', nodeId: 'first', visit: 2 }] })
  const resolve = composerActions(store)['composer.resolve']
  const discussion = resolve({ intent: 'use', ref })
  assert.deepEqual(discussion.ref, ref)
  assert.equal(discussion.route, '#/runs/run_test')
  assert.ok(discussion.title.includes('第 2 次'))
  assert.ok(discussion.instruction.includes('不代表执行'))
  assert.throws(() => resolve({ intent: 'use', ref: { ...ref, nodeId: 'missing' } }))
  assert.throws(() => resolve({ intent: 'use', ref: { ...ref, occurrenceId: 'first:1' } }))
  store.edit({ workflowId: flow.id, baseRevision: 1, yaml: single })
  assert.throws(() => resolve({ intent: 'use', ref: { ...ref, revision: 2 } }))
}))
test('definition rejects unsupported side effects, duplicate YAML keys and unknown destinations', () => {
  assert.equal(parseDefinition(single).config.initialStep, 'first')
  for (const yaml of [single + 'provider: codex\n', single.replace('instruction: Reply with hello', 'command: rm -rf x'), single.replace('max_steps: 4', 'max_steps: infinite'), single.replace('next: COMPLETE', 'next: unknown'), single + 'name: duplicate\n']) assert.throws(() => parseDefinition(yaml))
})
test('immutable revisions and bounded resources survive restart', () => fixture(async directory => {
  const store = new Store(directory), flow = store.create({ yaml: single, title: '验证' })
  store.edit({ workflowId: flow.id, baseRevision: 1, yaml: single.replace('hello', 'goodbye') })
  assert.throws(() => store.edit({ workflowId: flow.id, baseRevision: 1, yaml: single }))
  const restored = new Store(directory)
  assert.equal(restored.revision(flow.id, 1).yaml, single)
  assert.equal(restored.revision(flow.id).revision, 2)
  const text = '大结果😀'.repeat(5000), bound = store.bound(text)
  let offset = 0, actual = ''
  do { const chunk = restored.resource({ resourceRef: bound.resourceRef, offset, limit: 3000 }); actual += chunk.text; offset = chunk.nextOffset } while (offset !== null)
  assert.equal(actual, text)
  assert.throws(() => restored.resource({ resourceRef: '../catalog' }))
}))
test('real TAKT engine executes static parallel and collects both outputs', () => fixture(async directory => {
  const events = [], calls = []; let concurrent = 0, maxConcurrent = 0
  const result = await executeWorkflow({ yaml: example, task: '验证任务', directory, onEvent: e => events.push(e), callHost: async input => {
    calls.push(input); concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent)
    await new Promise(r => setTimeout(r, 20)); concurrent--
    return { value: input.outputSchema.properties.step ? { step: 1, reason: '已完成' } : { content: '本步骤已完成：' + input.step }, tokens: 3 }
  } })
  assert.equal(result.status, 'completed', result.error)
  assert.ok(maxConcurrent >= 2, 'parallel steps execute concurrently')
  assert.ok(calls.some(c => c.step === 'summarize'))
  assert.ok(calls.every(c => !c.prompt.includes('handled automatically by the system')))
  assert.ok(calls.some(c => c.prompt.includes('Moss TAKT does not automatically')))
  assert.ok(events.some(e => e.type === 'node.complete' && e.nodeId === 'reviews/feasibility'))
  assert.ok(events.some(e => e.type === 'node.complete' && e.nodeId === 'reviews/verification'))
}))
test('semantic judging and finite loops are executed through the same Host adapter', () => fixture(async directory => {
  const yaml = 'name: loop\nmax_steps: 6\nsteps:\n  - name: refine\n    instruction: 改进建议\n    rules:\n      - condition: 需要改进\n        next: refine\n      - condition: 完成\n        next: COMPLETE\n'
  const events = [], calls = []; let judged = 0
  const result = await executeWorkflow({ yaml, task: '迭代两次', directory, onEvent: e => events.push(e), callHost: async input => {
    calls.push(input)
    return { value: input.outputSchema.properties.step ? { step: ++judged === 1 ? 1 : 2, reason: 'fixture decision' } : { content: '需要独立审查的结果' }, tokens: 2 }
  } })
  assert.equal(result.status, 'completed', result.error)
  assert.equal(events.filter(e => e.type === 'node.start' && e.nodeId === 'refine').length, 2)
  assert.equal(judged, 2)
  assert.ok(calls.filter(c => c.phase === 3).every(c => c.resources.tools.length === 0))
  assert.equal(new Set(events.filter(e => e.type === 'node.start').map(e => e.occurrenceId)).size, 2)
}))
test('abort prevents dispatching downstream steps', () => fixture(async directory => {
  const controller = new AbortController(); let calls = 0
  const result = await executeWorkflow({ yaml: example, task: 'cancel', directory, signal: controller.signal, onEvent: () => {}, callHost: async () => { calls++; controller.abort(new Error('fixture cancelled')); throw controller.signal.reason } }).catch(error => ({ status: 'cancelled', error: error.message }))
  assert.equal(result.status, 'cancelled'); assert.equal(calls, 1)
}))
