import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { TaskStore, WORKER_READY_MESSAGE, WORKER_START_MESSAGE } from '../packages/engine-apps/src/runtime.mjs'
import { WorkerQueue } from '../packages/engine-apps/src/queue.mjs'

const terminal = new Set(['succeeded', 'failed', 'canceled', 'interrupted'])
async function waitFor(store, id, predicate = task => terminal.has(task.status)) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const task = await store.read(id)
    if (predicate(task)) return task
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`等待任务 ${id} 超时`)
}
async function waitForIdle(queue) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (!queue.active.size && !queue.pending.size && !queue.claims.size && !queue.leases.size) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('等待 worker 队列空闲超时')
}
async function waitUntil(predicate) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('等待状态更新超时')
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-engine-queue-'))
  const worker = path.join(root, 'worker.mjs'), events = path.join(root, 'events.jsonl')
  const runtime = new URL('../packages/engine-apps/src/runtime.mjs', import.meta.url).href
  await fs.writeFile(worker, `
import fs from 'node:fs/promises'
import { TaskStore, executeTask, waitForWorkerStart } from ${JSON.stringify(runtime)}
const parentSignal = await waitForWorkerStart()
const store = new TaskStore(process.argv[2]), task = await store.get(process.argv[3])
if (task.input.crash) process.exit(7)
await executeTask({ execute: async (input, context) => {
  await fs.appendFile(process.env.ENGINE_QUEUE_EVENTS, JSON.stringify({ kind: 'start', id: task.id }) + '\\n')
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, input.delay)
    context.signal.addEventListener('abort', () => { clearTimeout(timer); reject(context.signal.reason) }, { once: true })
  })
  await fs.appendFile(process.env.ENGINE_QUEUE_EVENTS, JSON.stringify({ kind: 'finish', id: task.id }) + '\\n')
  return { artifacts: [], message: '处理完成' }
} }, store, task, parentSignal)
`)
  return { root, worker, events, store: new TaskStore(root), cleanup: () => fs.rm(root, { recursive: true, force: true }) }
}

test('worker queue caps real child processes, rejects overflow and cancels waiting work immediately', async () => {
  const f = await fixture(), calls = [], errors = []
  const queue = new WorkerQueue({ store: f.store, worker: f.worker, concurrency: 2, maxQueued: 2,
    env: () => ({ ENGINE_QUEUE_EVENTS: f.events }), lease: async (operation, id) => { calls.push([operation, id]); return { active: true } },
    onError: error => errors.push(error),
  })
  try {
    const tasks = []
    for (let n = 0; n < 4; n++) tasks.push(await queue.start({ delay: 450 }))
    await assert.rejects(queue.start({ delay: 50 }), /任务队列已满/)
    assert.equal((await queue.cancel(tasks[3].id)).status, 'canceled')
    const replacement = await queue.start({ delay: 80 })
    const results = await Promise.all([...tasks.slice(0, 3), replacement].map(task => waitFor(f.store, task.id)))
    await waitForIdle(queue)
    assert(results.every(task => task.status === 'succeeded'), JSON.stringify(results))
    assert.equal((await f.store.read(tasks[3].id)).status, 'canceled')
    const lines = (await fs.readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    let running = 0, peak = 0
    for (const event of lines) {
      running += event.kind === 'start' ? 1 : -1
      peak = Math.max(peak, running)
    }
    assert.equal(peak, 2)
    assert.equal(running, 0)
    assert(!lines.some(event => event.id === tasks[3].id))
    await waitUntil(() => [...tasks, replacement].every(task => calls.some(([operation, id]) => operation === 'end' && id === task.id)))
    for (const task of [...tasks, replacement]) {
      assert(calls.some(([operation, id]) => operation === 'begin' && id === task.id))
      assert(calls.some(([operation, id]) => operation === 'end' && id === task.id))
    }
    assert.deepEqual(errors, [])
  } finally { await queue.shutdown(); await f.cleanup() }
})

test('shutdown leaves waiting jobs recoverable and stops a running worker', async () => {
  const f = await fixture(), errors = []
  const options = { store: f.store, worker: f.worker, concurrency: 1, maxQueued: 2,
    env: () => ({ ENGINE_QUEUE_EVENTS: f.events }), onError: error => errors.push(error) }
  const first = new WorkerQueue(options)
  try {
    const running = await first.start({ delay: 3000 })
    const waiting = await first.start({ delay: 40 })
    await waitFor(f.store, running.id, task => task.status === 'running')
    await first.shutdown()
    assert(terminal.has((await f.store.get(running.id)).status))
    assert.equal((await f.store.read(waiting.id)).status, 'queued')
    const second = new WorkerQueue(options)
    try {
      await second.restore()
      assert.equal((await waitFor(f.store, waiting.id)).status, 'succeeded')
      const lines = (await fs.readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      assert.equal(lines.filter(event => event.kind === 'start' && event.id === waiting.id).length, 1)
      assert.deepEqual(errors, [])
    } finally { await second.shutdown() }
  } finally { await first.shutdown(); await f.cleanup() }
})

test('spawn errors and worker crashes finalize tasks and free the queue slot', async () => {
  const f = await fixture(), errors = []
  const broken = new WorkerQueue({ store: f.store, worker: f.worker, executable: path.join(f.root, 'missing-node'),
    maxQueued: 1, onError: error => errors.push(error) })
  try {
    const first = await broken.start({ delay: 1 })
    assert.equal((await waitFor(f.store, first.id)).status, 'failed')
    const second = await broken.start({ delay: 1 })
    assert.equal((await waitFor(f.store, second.id)).status, 'failed')
  } finally { await broken.shutdown() }
  const crashing = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1, onError: error => errors.push(error) })
  try {
    const task = await crashing.start({ crash: true })
    const result = await waitFor(f.store, task.id, current => current.status === 'failed')
    assert.equal(result.status, 'failed')
    assert.match(result.message, /代码 7/)
    assert.deepEqual(errors, [])
  } finally { await crashing.shutdown(); await f.cleanup() }
})

test('worker requires an explicit start and stops when its parent disconnects', async () => {
  const f = await fixture()
  const children = new Set()
  const launch = task => {
    const child = spawn(process.execPath, [f.worker, f.root, task.id], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, ENGINE_QUEUE_EVENTS: f.events },
    })
    children.add(child)
    child.once('exit', () => children.delete(child))
    return child
  }
  const ready = child => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker did not become ready')), 3000)
    const onMessage = message => {
      if (message?.type !== WORKER_READY_MESSAGE) return
      clearTimeout(timer); child.off('message', onMessage); resolve()
    }
    child.on('message', onMessage)
  })
  const exited = child => new Promise(resolve => child.once('exit', resolve))
  try {
    const notStarted = await f.store.createQueued({ delay: 50 })
    const first = launch(notStarted), firstExit = exited(first)
    await ready(first)
    first.disconnect()
    await firstExit
    assert.equal((await f.store.read(notStarted.id)).status, 'queued')
    assert.equal(await fs.readFile(f.events, 'utf8').catch(() => ''), '')

    const running = await f.store.createQueued({ delay: 3000 })
    const second = launch(running), secondExit = exited(second)
    await ready(second)
    await new Promise((resolve, reject) => second.send({ type: WORKER_START_MESSAGE }, error => error ? reject(error) : resolve()))
    await waitFor(f.store, running.id, task => task.status === 'running')
    second.disconnect()
    await secondExit
    assert.equal((await f.store.read(running.id)).status, 'interrupted')
    const events = (await fs.readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert(events.some(event => event.kind === 'start' && event.id === running.id))
    assert(!events.some(event => event.kind === 'finish' && event.id === running.id))
  } finally {
    for (const child of children) child.kill('SIGKILL')
    await f.cleanup()
  }
})

test('a worker that never confirms startup fails and releases its queue slot', async () => {
  const f = await fixture(), worker = path.join(f.root, 'stalled-worker.mjs')
  await fs.writeFile(worker, 'setInterval(() => {}, 1000)\n')
  const queue = new WorkerQueue({ store: f.store, worker, workerReadyMs: 100, maxQueued: 1 })
  try {
    const task = await queue.start({ delay: 1 })
    const result = await waitFor(f.store, task.id, current => current.status === 'failed')
    assert.match(result.message, /启动超时/)
    await waitForIdle(queue)
  } finally { await queue.shutdown(); await f.cleanup() }
})

test('startup timeout force-kills a worker that ignores SIGTERM', async () => {
  const f = await fixture(), worker = path.join(f.root, 'stubborn-worker.mjs')
  await fs.writeFile(worker, "process.on('SIGTERM', () => {})\nsetInterval(() => {}, 1000)\n")
  const queue = new WorkerQueue({ store: f.store, worker, workerReadyMs: 100, maxQueued: 1 })
  try {
    const task = await queue.start({ delay: 1 })
    const result = await waitFor(f.store, task.id, current => current.status === 'failed')
    assert.match(result.message, /启动超时/)
    await waitForIdle(queue)
  } finally { await queue.shutdown(); await f.cleanup() }
})

test('recovery waits for a claimed worker PID to exit before releasing its slot', async () => {
  const f = await fixture(), errors = []
  const oldTask = await f.store.createQueued({ delay: 3000 })
  const oldProcess = spawn(process.execPath, [f.worker, f.root, oldTask.id], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, ENGINE_QUEUE_EVENTS: f.events },
  })
  const queue = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    env: () => ({ ENGINE_QUEUE_EVENTS: f.events }), onError: error => errors.push(error) })
  try {
    await new Promise((resolve, reject) => {
      oldProcess.once('error', reject)
      oldProcess.on('message', message => { if (message?.type === WORKER_READY_MESSAGE) resolve() })
    })
    await new Promise((resolve, reject) => oldProcess.send({ type: WORKER_START_MESSAGE }, error => error ? reject(error) : resolve()))
    await waitFor(f.store, oldTask.id, task => task.status === 'running')
    await queue.restore()
    assert.equal(queue.claims.size, 1)
    const waiting = await queue.start({ delay: 40 })
    assert.equal(queue.pending.has(waiting.id), true)
    await assert.rejects(queue.start({ delay: 40 }), /任务队列已满/)
    await new Promise(resolve => setTimeout(resolve, 100))
    const beforeExit = (await fs.readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert(!beforeExit.some(event => event.id === waiting.id))
    const exited = new Promise(resolve => oldProcess.once('exit', resolve))
    oldProcess.kill('SIGTERM')
    await exited
    assert.equal((await waitFor(f.store, oldTask.id)).status, 'interrupted')
    assert.equal((await waitFor(f.store, waiting.id)).status, 'succeeded')
    await waitForIdle(queue)
    assert.equal((await fs.readdir(f.store.pendingRoot)).length, 0)
    assert.deepEqual(errors, [])
  } finally { oldProcess.kill('SIGKILL'); await queue.shutdown(); await f.cleanup() }
})

test('recovery discards a recycled PID without blocking queued work', async () => {
  const f = await fixture(), unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  const queue = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 2,
    env: () => ({ ENGINE_QUEUE_EVENTS: f.events }) })
  try {
    const stale = await f.store.createQueued({ delay: 40 })
    await f.store.write({ ...stale, status: 'running', pid: unrelated.pid, startedAt: Date.now() - 1000 })
    const waiting = await f.store.createQueued({ delay: 40 })
    await queue.restore()
    assert.equal((await waitFor(f.store, stale.id)).status, 'interrupted')
    assert.equal((await waitFor(f.store, waiting.id)).status, 'succeeded')
    await waitForIdle(queue)
    assert.equal((await fs.readdir(f.store.pendingRoot)).length, 0)
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0))
  } finally { unrelated.kill('SIGKILL'); await queue.shutdown(); await f.cleanup() }
})

test('deferred recovery does not start queued work when an old claim clears', async () => {
  const f = await fixture()
  const oldTask = await f.store.createQueued({ delay: 3000 })
  const waiting = await f.store.createQueued({ delay: 40 })
  const oldProcess = spawn(process.execPath, [f.worker, f.root, oldTask.id], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, ENGINE_QUEUE_EVENTS: f.events },
  })
  const queue = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    env: () => ({ ENGINE_QUEUE_EVENTS: f.events }) })
  try {
    await new Promise((resolve, reject) => {
      oldProcess.once('error', reject)
      oldProcess.on('message', message => { if (message?.type === WORKER_READY_MESSAGE) resolve() })
    })
    await new Promise((resolve, reject) => oldProcess.send({ type: WORKER_START_MESSAGE }, error => error ? reject(error) : resolve()))
    await waitFor(f.store, oldTask.id, task => task.status === 'running')
    await queue.restore({ start: false })
    assert.equal(queue.claims.size, 1)
    const exited = new Promise(resolve => oldProcess.once('exit', resolve))
    oldProcess.kill('SIGTERM')
    await exited
    assert.equal((await waitFor(f.store, oldTask.id)).status, 'interrupted')
    assert.equal((await f.store.read(waiting.id)).status, 'queued')
    const beforePump = (await fs.readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert(!beforePump.some(event => event.id === waiting.id))
    queue.pump()
    assert.equal((await waitFor(f.store, waiting.id)).status, 'succeeded')
  } finally { oldProcess.kill('SIGKILL'); await queue.shutdown(); await f.cleanup() }
})

test('claim recovery preserves a result saved just before the worker exits', async () => {
  const f = await fixture()
  class RacingStore extends TaskStore {
    reads = 0
    async read(id) {
      const task = await super.read(id)
      if (this.reads++ === 0) {
        const final = { ...task, status: 'succeeded', message: '已完成' }
        delete final.pid
        await super.write(final)
      }
      return task
    }
  }
  try {
    const task = await f.store.createQueued({ delay: 40 })
    await f.store.write({ ...task, pid: 99999999 })
    const store = new RacingStore(f.root)
    assert.equal(await store.reconcileClaim(task.id), true)
    assert.equal((await f.store.read(task.id)).status, 'succeeded')
    assert.equal((await fs.readdir(f.store.pendingRoot)).length, 0)
  } finally { await f.cleanup() }
})

test('admission reserves capacity during validation and recovered leases retry Host startup', async () => {
  const f = await fixture(), errors = []
  let releaseValidation
  const validation = new Promise(resolve => { releaseValidation = resolve })
  const queue = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    env: () => ({ ENGINE_QUEUE_EVENTS: f.events }), onError: error => errors.push(error) })
  try {
    const first = queue.start({ delay: 40 }, 'ui', () => validation)
    const second = queue.start({ delay: 40 }, 'ui', () => validation)
    await assert.rejects(queue.start({ delay: 40 }), /任务队列已满/)
    releaseValidation()
    const accepted = await Promise.all([first, second])
    assert((await Promise.all(accepted.map(task => waitFor(f.store, task.id)))).every(task => task.status === 'succeeded'))
    await waitForIdle(queue)
  } finally { await queue.shutdown() }

  const recovered = await f.store.createQueued({ delay: 40 })
  let attempts = 0
  const leaseQueue = new WorkerQueue({ store: f.store, worker: f.worker, concurrency: 1, maxQueued: 1,
    env: () => ({ ENGINE_QUEUE_EVENTS: f.events }), onError: error => errors.push(error),
    lease: async operation => {
      if (operation === 'begin' && ++attempts < 3) throw Object.assign(new Error('Host starting'), { code: 'APP_STALE_GENERATION' })
      return { active: true }
    },
  })
  try {
    await leaseQueue.restore()
    assert.equal((await waitFor(f.store, recovered.id)).status, 'succeeded')
    assert.equal(attempts, 3)
    assert.deepEqual(errors, [])
  } finally { await leaseQueue.shutdown(); await f.cleanup() }
  assert.throws(() => new WorkerQueue({ store: f.store, worker: f.worker, concurrency: 4, maxQueued: 29, lease: async () => {} }), /最多登记 32/)
})

test('a failed activity.begin releases a possible Host lease even before local state exists', async () => {
  const f = await fixture(), calls = [], errors = []
  let active = false
  const queue = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    onError: error => errors.push(error), lease: async (operation, id) => {
      calls.push([operation, id])
      if (operation === 'begin') { active = true; throw new Error('begin reply lost') }
      if (operation === 'end') active = false
    } })
  try {
    await assert.rejects(queue.start({ delay: 40 }), /begin reply lost/)
    assert.equal(active, false)
    assert.deepEqual(calls.map(([operation]) => operation), ['begin', 'end'])
    assert.equal((await f.store.read(calls[0][1])).status, 'failed')
    assert.equal((await fs.readdir(f.store.pendingRoot)).length, 0)
    assert.deepEqual(errors, [])
  } finally { await queue.shutdown(); await f.cleanup() }
})

test('activity.begin and renew require an explicit active confirmation', async () => {
  const f = await fixture(), calls = []
  const unconfirmed = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    lease: async (operation, id) => { calls.push([operation, id]); return undefined } })
  try {
    await assert.rejects(unconfirmed.start({ delay: 40 }), /Host 未确认任务活动/)
    assert.deepEqual(calls.map(([operation]) => operation), ['begin', 'end'])
    assert.equal((await f.store.read(calls[0][1])).status, 'failed')
  } finally { await unconfirmed.shutdown() }

  const errors = []
  const lostRenewal = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    env: () => ({ ENGINE_QUEUE_EVENTS: f.events }), onError: error => errors.push(error),
    activityTiming: { renewMs: 20, retryMs: 10, failureMs: 150 },
    lease: async operation => operation === 'renew' ? undefined : { active: true } })
  try {
    const task = await lostRenewal.start({ delay: 1000 })
    assert.equal((await waitFor(f.store, task.id, current => current.status === 'failed')).status, 'failed')
    await waitForIdle(lostRenewal)
    assert(errors.some(error => /活动续约/.test(error.message)))
  } finally { await lostRenewal.shutdown(); await f.cleanup() }
})

test('lost Host activity stops a running worker before the lease expires', async () => {
  const f = await fixture(), errors = []
  const queue = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    env: () => ({ ENGINE_QUEUE_EVENTS: f.events }), onError: error => errors.push(error),
    activityTiming: { renewMs: 20, retryMs: 10, failureMs: 150 },
    lease: async operation => {
      if (operation === 'renew') throw new Error('Host 暂不可用')
      return { active: true }
    },
  })
  try {
    const task = await queue.start({ delay: 1000 })
    const result = await waitFor(f.store, task.id, current => current.status === 'failed')
    assert.equal(result.status, 'failed')
    assert.match(result.message, /活动续约持续失败/)
    await waitForIdle(queue)
    assert(errors.some(error => /活动续约/.test(error.message)))
    assert.equal((await fs.readdir(f.store.pendingRoot)).length, 0)
  } finally { await queue.shutdown(); await f.cleanup() }
})

test('lost activity fails a waiting task without starting its worker', async () => {
  const f = await fixture(), errors = []
  let waitingId
  const queue = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    env: () => ({ ENGINE_QUEUE_EVENTS: f.events }), onError: error => errors.push(error),
    activityTiming: { renewMs: 20, retryMs: 10, failureMs: 150 },
    lease: async (operation, id) => {
      if (operation === 'renew' && id === waitingId) throw new Error('Host 暂不可用')
      return { active: true }
    },
  })
  try {
    const running = await queue.start({ delay: 450 })
    const waiting = await queue.start({ delay: 40 }); waitingId = waiting.id
    assert.equal((await waitFor(f.store, waiting.id)).status, 'failed')
    assert.equal((await waitFor(f.store, running.id)).status, 'succeeded')
    const lines = (await fs.readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert(!lines.some(event => event.id === waiting.id))
    assert(errors.some(error => /活动续约/.test(error.message)))
  } finally { await queue.shutdown(); await f.cleanup() }
})

test('aborted and closing starts never leave a queued task behind', async () => {
  const f = await fixture()
  const makeGate = () => {
    let entered, release
    const started = new Promise(resolve => { entered = resolve })
    const gate = new Promise(resolve => { release = resolve })
    return { started, entered, release, gate }
  }
  const canceledGate = makeGate(), canceled = new AbortController()
  const first = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    lease: async operation => { if (operation === 'begin') { canceledGate.entered(); return canceledGate.gate }; return { active: true } },
  })
  try {
    const immediateAbort = new AbortController()
    let immediateValidationStarted = false
    const immediatelyCanceled = first.start({ delay: 50 }, 'ui', () => { immediateValidationStarted = true }, immediateAbort.signal)
    immediateAbort.abort(new Error('提交立即取消'))
    await assert.rejects(immediatelyCanceled, /提交立即取消/)
    assert.equal(immediateValidationStarted, false)
    assert.equal(first.admitting, 0)

    const validationGate = makeGate(), validationAbort = new AbortController()
    const validating = first.start({ delay: 50 }, 'ui', async () => { validationGate.entered(); await validationGate.gate }, validationAbort.signal)
    await validationGate.started
    validationAbort.abort(new Error('校验已取消'))
    await assert.rejects(validating, /校验已取消/)
    assert.equal(first.admitting, 0)
    validationGate.release()
    const starting = first.start({ delay: 50 }, 'ui', async () => {}, canceled.signal)
    await canceledGate.started
    canceled.abort(new Error('用户取消提交'))
    canceledGate.release({ active: true })
    await assert.rejects(starting, /用户取消提交/)
    const [task] = await f.store.list()
    assert.equal(task.status, 'canceled')
    assert.equal((await fs.readdir(f.store.pendingRoot)).length, 0)
  } finally { await first.shutdown() }

  const closingGate = makeGate(), closingCalls = []
  const second = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    lease: async operation => {
      closingCalls.push(operation)
      if (operation === 'begin') { closingGate.entered(); return closingGate.gate }
      return { active: true }
    },
  })
  try {
    const starting = second.start({ delay: 50 })
    await closingGate.started
    await second.shutdown()
    closingGate.release({ active: true })
    await assert.rejects(starting, /任务后台正在关闭/)
    assert.deepEqual(closingCalls, ['begin', 'end'])
    const tasks = await f.store.list()
    assert(tasks.some(task => task.status === 'interrupted'))
    assert.equal((await fs.readdir(f.store.pendingRoot)).length, 0)
  } finally { await second.shutdown(); await f.cleanup() }
})

test('shutdown waits for an admission that is still writing its queued task', async () => {
  const f = await fixture()
  let entered, release
  const created = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  class GatedStore extends TaskStore {
    async createQueued(...args) {
      const task = await super.createQueued(...args)
      entered(task)
      await gate
      return task
    }
  }
  const store = new GatedStore(f.root), queue = new WorkerQueue({ store, worker: f.worker, maxQueued: 1 })
  try {
    const starting = queue.start({ delay: 40 })
    const task = await created
    let stopped = false
    const stopping = queue.shutdown().then(() => { stopped = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(stopped, false)
    release()
    await assert.rejects(starting, /任务后台正在关闭/)
    await stopping
    assert.equal((await store.read(task.id)).status, 'interrupted')
    assert.equal((await fs.readdir(store.pendingRoot)).length, 0)
    assert.equal(await fs.readFile(f.events, 'utf8').catch(() => ''), '')
  } finally { release(); await queue.shutdown(); await f.cleanup() }
})

test('shutdown aborts a recovered Host registration that never replies', async () => {
  const f = await fixture(), task = await f.store.createQueued({ delay: 40 }), calls = []
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const queue = new WorkerQueue({ store: f.store, worker: f.worker, maxQueued: 1,
    lease: async operation => {
      calls.push(operation)
      if (operation === 'begin') { entered(); return gate }
      return { active: false }
    } })
  try {
    const restoring = queue.restore({ start: false })
    await started
    let timer
    try {
      await Promise.race([
        Promise.all([restoring, queue.shutdown()]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('shutdown waited for a late Host reply')), 1000) }),
      ])
    } finally { clearTimeout(timer) }
    assert.deepEqual(calls, ['begin', 'end'])
    assert.equal((await f.store.read(task.id)).status, 'queued')
    assert.equal((await fs.readdir(f.store.pendingRoot)).length, 1)
  } finally { release({ active: true }); await queue.shutdown(); await f.cleanup() }
})

test('TaskStore indexes legacy history and later lists read only the newest page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-engine-history-'))
  class CountingStore extends TaskStore {
    reads = 0
    async read(id) { this.reads++; return super.read(id) }
  }
  const store = new CountingStore(root)
  try {
    const ids = []
    for (let n = 0; n < 300; n++) {
      const id = randomUUID()
      ids.push(id)
      await store.write({ id, input: {}, source: 'ui', status: 'succeeded', createdAt: n + 1, message: '完成', artifacts: [] })
    }
    assert.deepEqual((await store.list()).map(task => task.id), ids.slice(100).reverse())
    assert.equal((await fs.readdir(store.createdRoot)).length, 300)
    store.reads = 0
    assert.deepEqual((await store.list({ limit: 5 })).map(task => task.id), ids.slice(-5).reverse())
    assert.equal(store.reads, 5, `第二次列表读取了 ${store.reads} 个任务`)
    const fresh = await store.create({})
    assert.equal((await store.list({ limit: 1 }))[0].id, fresh.id)
    await fs.writeFile(path.join(store.directory(fresh.id), 'task.json'), '{broken')
    assert.equal((await store.list({ limit: 1 }))[0].id, ids.at(-1))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
