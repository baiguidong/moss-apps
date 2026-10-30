import { spawn } from 'node:child_process'
import { WORKER_READY_MESSAGE, WORKER_START_MESSAGE } from './runtime.mjs'

const activeStatuses = new Set(['queued', 'running'])
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const defaultActivityTiming = { renewMs: 30_000, retryMs: 5_000, failureMs: 75_000 }
const activityFailureMessage = 'Host 任务活动续约持续失败，任务已停止，请重试'
function runWithSignal(operation, signal) {
  signal?.throwIfAborted()
  if (!signal) return Promise.resolve().then(operation)
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason || new Error('请求已取消')) }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation() }).then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
    if (signal.aborted) abort()
  })
}
async function waitUpTo(promises, ms) {
  let timer
  try { await Promise.race([Promise.all(promises), new Promise(resolve => { timer = setTimeout(resolve, ms) })]) }
  finally { clearTimeout(timer) }
}
function waitForWorkerReady(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('工作进程启动超时')), timeoutMs)
    timer.unref?.()
    const onMessage = message => { if (message?.type === WORKER_READY_MESSAGE) done() }
    const onError = error => done(error)
    const onClose = () => done(new Error('工作进程尚未就绪就退出'))
    const done = error => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('error', onError)
      child.off('close', onClose)
      if (error) reject(error)
      else resolve()
    }
    child.on('message', onMessage)
    child.once('error', onError)
    child.once('close', onClose)
  })
}

export class WorkerQueue {
  constructor({ store, worker, dataDir = store.dataDir, env = () => ({}), lease = null,
    onChanged = () => {}, onError = error => console.error(error),
    concurrency = 1, maxQueued = 32 - concurrency, executable = process.execPath, workerReadyMs = 30_000,
    activityTiming = defaultActivityTiming }) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('workerConcurrency 必须在 1–4 之间')
    if (!Number.isInteger(maxQueued) || maxQueued < 1 || maxQueued > 256) throw new Error('maxQueuedTasks 必须在 1–256 之间')
    if (!Number.isInteger(workerReadyMs) || workerReadyMs < 1 || workerReadyMs > 120_000) throw new Error('工作进程启动超时配置无效')
    if (lease && concurrency + maxQueued > 32) throw new Error('按需后台最多登记 32 个运行或等待任务')
    if (['renewMs', 'retryMs', 'failureMs'].some(key => !Number.isInteger(activityTiming[key]) || activityTiming[key] < 1)) throw new Error('任务活动续约时间无效')
    this.store = store; this.worker = worker; this.dataDir = dataDir; this.env = env
    this.lease = lease; this.onChanged = onChanged; this.onError = onError
    this.concurrency = concurrency; this.maxQueued = maxQueued; this.executable = executable; this.workerReadyMs = workerReadyMs
    this.activityTiming = activityTiming
    this.pending = new Map(); this.active = new Map(); this.claims = new Map(); this.leases = new Map(); this.admissions = new Set()
    this.admitting = 0; this.closed = false; this.pumping = false; this.pumpPromise = null; this.pumpEnabled = true
    this.shutdownController = new AbortController()
  }

  notifyChanged() {
    try { this.onChanged() } catch (error) { this.onError(error) }
  }

  async beginLease(id, signal) {
    if (!this.lease) return
    try {
      for (let attempt = 0; ; attempt++) {
        if (this.closed) throw new Error('任务后台正在关闭')
        signal?.throwIfAborted()
        try {
          const result = await runWithSignal(() => this.lease('begin', id, signal), signal)
          if (result?.active !== true) throw new Error('Host 未确认任务活动')
          if (this.closed) throw new Error('任务后台正在关闭')
          break
        }
        catch (error) {
          if (signal?.aborted || this.closed || error.code !== 'APP_STALE_GENERATION' || attempt >= 19) throw error
          await delay(50)
        }
      }
    } catch (error) {
      // A timed-out begin may already have reached Host; release even without local lease state.
      await Promise.resolve().then(() => this.lease('end', id)).catch(this.onError)
      throw error
    }
    const state = { timer: null, deadline: null, pending: null, confirmedAt: Date.now(), failures: 0, ended: false, lost: false }
    this.leases.set(id, state)
    this.scheduleDeadline(id, state)
    this.scheduleRenewal(id, state, this.activityTiming.renewMs)
  }

  scheduleDeadline(id, state) {
    if (state.deadline) clearTimeout(state.deadline)
    state.deadline = setTimeout(() => { void this.loseLease(id, state).catch(this.onError) }, this.activityTiming.failureMs)
    state.deadline.unref?.()
  }

  scheduleRenewal(id, state, interval) {
    if (state.ended || state.lost || this.closed) return
    state.timer = setTimeout(() => {
      state.timer = null
      void this.renewLease(id, state).catch(this.onError)
    }, interval)
    state.timer.unref?.()
  }

  async renewLease(id, state) {
    if (state.ended || state.lost || this.closed || state.pending || this.leases.get(id) !== state) return
    const request = Promise.resolve().then(() => this.lease('renew', id))
    state.pending = request
    try {
      const result = await request
      if (result?.active !== true) throw Object.assign(new Error('Host 未确认任务活动'), { code: 'APP_LEASE_LOST' })
      if (state.ended || state.lost) return
      state.confirmedAt = Date.now(); state.failures = 0
      this.scheduleDeadline(id, state)
      this.scheduleRenewal(id, state, this.activityTiming.renewMs)
    } catch (error) {
      if (state.ended || state.lost || this.closed) return
      state.failures++
      if (state.failures === 1) this.onError(new Error(`任务 ${id} 活动续约失败：${error.message}`))
      if (['APP_LEASE_LOST', 'APP_STALE_GENERATION', 'APP_INVALID_ACTION_INPUT'].includes(error.code)
        || Date.now() - state.confirmedAt >= this.activityTiming.failureMs) await this.loseLease(id, state)
      else this.scheduleRenewal(id, state, this.activityTiming.retryMs)
    } finally { if (state.pending === request) state.pending = null }
  }

  async loseLease(id, state) {
    if (state.ended || state.lost || this.closed || this.leases.get(id) !== state) return
    state.lost = true
    if (state.timer) clearTimeout(state.timer)
    if (state.deadline) clearTimeout(state.deadline)
    this.onError(new Error(`任务 ${id} 活动续约超过 ${this.activityTiming.failureMs} ms 未获确认`))
    const waiting = this.pending.get(id)
    if (waiting) {
      this.admitting++
      this.pending.delete(id)
      try { await this.finishQueued(waiting, 'failed', activityFailureMessage) }
      finally { this.admitting--; this.pump() }
      return
    }
    const entry = this.active.get(id)
    if (!entry) { await this.endLease(id); return }
    entry.activityFailure = activityFailureMessage
    if (entry.child) this.stopChild(entry)
  }

  stopChild(entry) {
    entry.child?.kill('SIGTERM')
    if (entry.forceKill) return
    entry.forceKill = setTimeout(() => entry.child?.kill('SIGKILL'), 5000)
    entry.forceKill.unref?.()
  }

  async endLease(id) {
    const state = this.leases.get(id)
    if (!state) return
    state.ended = true
    if (state.timer) clearTimeout(state.timer)
    if (state.deadline) clearTimeout(state.deadline)
    this.leases.delete(id)
    if (this.closed) return
    await state.pending?.catch(() => {})
    if (!this.closed) await Promise.resolve().then(() => this.lease('end', id)).catch(error => { this.onError(error) })
  }

  async restore({ start = true } = {}) {
    if (this.closed) return
    this.pumpEnabled = start
    const { queued, claimed } = await this.store.pending({ includeClaimed: true })
    if (this.closed) return
    await Promise.all(claimed.map(id => this.watchClaim(id)))
    if (this.closed) return
    for (const task of queued) {
      if (this.closed) return
      const canceled = await this.store.isCanceled(task.id)
      if (this.closed) return
      if (canceled) {
        await this.finishQueued(task, 'canceled', '任务已取消')
        continue
      }
      try { await this.beginLease(task.id, this.shutdownController.signal) }
      catch (error) {
        if (this.closed) return
        await this.finishQueued(task, 'failed', `恢复任务失败：${error.message}`)
        continue
      }
      if (this.closed) { await this.endLease(task.id); return }
      this.pending.set(task.id, task)
    }
    if (start) this.pump()
  }

  async watchClaim(id) {
    if (this.closed || this.claims.has(id)) return
    this.claims.set(id, null)
    const check = async () => {
      if (this.closed) return
      try {
        if (await this.store.reconcileClaim(id)) {
          this.claims.delete(id)
          this.notifyChanged()
          if (this.pumpEnabled) this.pump()
          return
        }
      } catch (error) { this.onError(error) }
      if (this.closed) return
      const timer = setTimeout(() => { void check() }, 250)
      timer.unref?.()
      this.claims.set(id, timer)
    }
    await check()
  }

  async start(input, source = 'ui', validate = async () => {}, signal) {
    if (this.closed) throw new Error('任务后台正在关闭')
    signal?.throwIfAborted()
    const admissionSignal = signal ? AbortSignal.any([signal, this.shutdownController.signal]) : this.shutdownController.signal
    if (this.admitting + this.pending.size + this.active.size + this.claims.size >= this.concurrency + this.maxQueued) {
      throw new Error('任务队列已满，请等待当前任务结束')
    }
    let completeAdmission
    const admissionDone = new Promise(resolve => { completeAdmission = resolve })
    this.admissions.add(admissionDone)
    this.admitting++
    let reserved = true, task
    try {
      await runWithSignal(validate, admissionSignal)
      admissionSignal.throwIfAborted()
      if (this.closed) throw new Error('任务后台正在关闭')
      task = await this.store.createQueued(input, source)
      admissionSignal.throwIfAborted()
      await this.beginLease(task.id, admissionSignal)
      admissionSignal.throwIfAborted()
      if (this.closed) throw new Error('任务后台正在关闭')
      this.admitting--; reserved = false
      this.pending.set(task.id, task)
      this.pump()
      this.notifyChanged()
      return task
    } catch (error) {
      if (task) {
        const status = this.closed ? 'interrupted' : signal?.aborted ? 'canceled' : 'failed'
        await this.finishQueued(task, status, status === 'canceled' ? '请求已取消' : status === 'interrupted' ? '任务后台已关闭，请重试' : String(error.message || error)).catch(this.onError)
      }
      throw error
    } finally {
      if (reserved) this.admitting--
      this.admissions.delete(admissionDone)
      completeAdmission()
    }
  }

  async cancel(id) {
    const task = await this.store.cancel(id)
    const pending = this.pending.get(id)
    if (!pending) return task
    this.admitting++
    this.pending.delete(id)
    try { await this.finishQueued(pending, 'canceled', '任务已取消') }
    finally { this.admitting--; this.pump() }
    return this.store.get(id)
  }

  async finishQueued(task, status, message) {
    try {
      const current = await this.store.read(task.id)
      if (current.status === 'queued' && !current.pid) {
        const canceled = await this.store.isCanceled(task.id)
        await this.store.write({ ...current, status: canceled ? 'canceled' : status,
          message: canceled ? '任务已取消' : message, finishedAt: Date.now() })
      }
      await this.store.dequeue(task.id)
    } finally {
      await this.endLease(task.id)
      this.notifyChanged()
    }
  }

  pump() {
    if (this.closed) return
    this.pumpEnabled = true
    if (this.pumping) return
    this.pumping = true
    this.pumpPromise = this.runPump().catch(error => this.onError(error)).finally(() => {
      this.pumping = false; this.pumpPromise = null
      if (!this.closed && this.pending.size && this.active.size + this.claims.size < this.concurrency) this.pump()
    })
  }

  async runPump() {
    while (!this.closed && this.active.size + this.claims.size < this.concurrency && this.pending.size) {
      const [id, task] = this.pending.entries().next().value
      this.pending.delete(id)
      let complete
      const entry = { task, child: null, ready: Promise.resolve(), done: new Promise(resolve => { complete = resolve }), complete, error: null, finalizing: false }
      this.active.set(id, entry)
      try {
        if (await this.store.isCanceled(id)) {
          await this.finalize(entry, 'canceled', '任务已取消')
          continue
        }
        if (entry.activityFailure) {
          await this.finalize(entry, 'failed', entry.activityFailure)
          continue
        }
        if (this.closed) {
          this.active.delete(id); this.pending.set(id, task); entry.complete()
          break
        }
        await this.launch(entry)
      } catch (error) {
        await this.finalize(entry, 'failed', entry.activityFailure || String(error.message || error))
      }
    }
  }

  async launch(entry) {
    const { task } = entry
    if (entry.activityFailure) throw new Error(entry.activityFailure)
    const child = spawn(this.executable, [this.worker, this.dataDir, task.id], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], shell: false, env: { ...process.env, ...this.env() },
    })
    entry.child = child
    child.once('error', error => { entry.error = error })
    child.once('close', (code, signal) => {
      void entry.ready.catch(() => {}).then(() => this.finalize(entry, null, this.exitMessage(entry, code, signal))).catch(this.onError)
    })
    entry.ready = (async () => {
      if (!child.pid) return
      await waitForWorkerReady(child, this.workerReadyMs)
      await this.store.write({ ...task, pid: child.pid })
      if (this.closed || entry.activityFailure) this.stopChild(entry)
      else await new Promise((resolve, reject) => child.send({ type: WORKER_START_MESSAGE }, error => error ? reject(error) : resolve()))
    })()
    try { await entry.ready }
    catch (error) {
      entry.error = error; this.stopChild(entry)
    }
  }

  exitMessage(entry, code, signal) {
    if (entry.error) return `工作进程启动失败：${entry.error.message}`
    if (code === 0) return '工作进程退出前未保存任务结果'
    return `工作进程异常退出：${code === null ? signal || '未知信号' : `代码 ${code}`}`
  }

  async finalize(entry, forcedStatus, message) {
    if (entry.finalizing) return
    entry.finalizing = true
    const { task } = entry
    try {
      const current = await this.store.read(task.id)
      const canceled = await this.store.isCanceled(task.id)
      const leaseStopped = entry.activityFailure && !canceled && (activeStatuses.has(current.status) || ['canceled', 'interrupted'].includes(current.status))
      if (leaseStopped || activeStatuses.has(current.status)) {
        const status = canceled ? 'canceled' : leaseStopped ? 'failed' : forcedStatus || (this.closed ? 'interrupted' : 'failed')
        const final = { ...current, status, message: canceled ? '任务已取消' : leaseStopped ? entry.activityFailure : message, finishedAt: Date.now() }
        delete final.pid
        await this.store.write(final)
      }
      await this.store.dequeue(task.id)
    } catch (error) { this.onError(error) }
    finally {
      if (entry.forceKill) clearTimeout(entry.forceKill)
      await this.endLease(task.id)
      this.active.delete(task.id)
      entry.complete()
      this.notifyChanged()
      this.pump()
    }
  }

  async shutdown({ waitForExit = false } = {}) {
    if (this.closed) return
    this.closed = true
    this.shutdownController.abort(new Error('任务后台正在关闭'))
    for (const timer of this.claims.values()) if (timer) clearTimeout(timer)
    this.claims.clear()
    const active = [...this.active.values()]
    for (const entry of active) entry.child?.kill('SIGTERM')
    await Promise.all([...this.admissions])
    await this.pumpPromise?.catch(() => {})
    await waitUpTo(active.map(entry => entry.done), 3000)
    for (const entry of this.active.values()) entry.child?.kill('SIGKILL')
    if (waitForExit) await Promise.all([...this.active.values()].map(entry => entry.done))
    else await waitUpTo([...this.active.values()].map(entry => entry.done), 1000)
    await Promise.all([...this.pending.keys()].map(id => this.endLease(id)))
    this.pending.clear()
  }
}
