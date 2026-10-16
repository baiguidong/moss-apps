import { spawn } from 'node:child_process'
export function runProcess(command, args, { signal, onOutput = () => {}, cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let tail = '', killTimer
    const abort = () => { child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 1500); killTimer.unref() }
    signal?.addEventListener('abort', abort, { once: true })
    const output = chunk => { const text = chunk.toString(); tail = (tail + text).slice(-4000); onOutput(text) }
    child.stdout.on('data', output); child.stderr.on('data', output)
    child.on('error', error => { signal?.removeEventListener('abort', abort); reject(error) })
    child.on('close', code => { signal?.removeEventListener('abort', abort); clearTimeout(killTimer); if (signal?.aborted) reject(new Error('已取消')); else if (code !== 0) reject(new Error(`本地引擎失败（${code}）：${tail}`)); else resolve(tail) })
  })
}
export function startWorker(execute) {
  const controller = new AbortController()
  let started = false
  const stop = () => { controller.abort(); const timer = setTimeout(() => process.exit(1), 2500); timer.unref() }
  process.once('disconnect', stop); process.once('SIGTERM', stop)
  process.on('message', async message => {
    if (message.type === 'cancel') { stop(); return }
    if (message.type !== 'run' || started) return
    started = true
    try {
      const result = await execute({ ...message, signal: controller.signal, progress: (progress, message) => { if (process.connected) process.send({ type: 'progress', progress, message }) } })
      if (process.connected) process.send({ type: 'result', result }, () => process.exit(0)); else process.exit(0)
    } catch (error) { if (process.connected) process.send({ type: 'error', message: error.message }, () => process.exit(1)); else process.exit(1) }
  })
}
