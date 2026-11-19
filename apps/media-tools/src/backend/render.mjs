import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TaskStore, run } from '@moss/engine-apps/runtime'
import { ffmpeg } from './speech.mjs'
import { serialQueue } from './projects.mjs'

export async function createRenders({ root, dataDir, transfer, changed }) {
  const store = new TaskStore(dataDir),
    pendingDir = path.join(root, 'renders'),
    serial = serialQueue()
  const pending = new Set(),
    executions = new Set()
  let active = null
  const marker = (id) => path.join(pendingDir, id)
  const capture = (id) => path.join(store.directory(id), 'capture.webm')
  await fs.mkdir(pendingDir, { recursive: true })
  async function terminal(task, status, message, extra = {}) {
    if (active?.id === task.id) {
      transfer.revoke(active.upload.id)
      active.controller.abort()
      active = null
    }
    await store.write({ ...task, status, message, finishedAt: Date.now(), ...extra })
    await fs.rm(marker(task.id), { force: true })
    pending.delete(task.id)
    await fs.rm(capture(task.id), { force: true })
    changed()
  }
  for (const id of await fs.readdir(pendingDir)) {
    const task = await store.read(id).catch(() => null)
    if (task?.status === 'queued') pending.add(id)
    else if (task?.status === 'running')
      await terminal(task, 'interrupted', '录制窗口或编码进程已关闭，可重试')
    else await fs.rm(marker(id), { force: true })
  }
  const tick = () =>
    serial(async () => {
      for (const id of pending) {
        const canceled = await store.isCanceled(id)
        if (canceled) await terminal(await store.read(id), 'canceled', '任务已取消')
        else if (active?.id === id && !active.encoding && Date.now() - active.seen > 30_000)
          await terminal(await store.read(id), 'interrupted', '录制窗口已关闭，可重试')
      }
    })
  const timer = setInterval(() => {
    void tick().catch(console.error)
  }, 1500)
  timer.unref()
  function requireLease({ id, lease }) {
    if (!active || active.id !== id || active.lease !== lease) throw new Error('录制已结束或已由其他窗口接手')
    return active
  }
  return {
    submit: (project, source) =>
      serial(async () => {
        if (pending.size >= 32) throw new Error('口播队列已满')
        if (project.source === 'script' ? !project.script.trim() : !project.audioId)
          throw new Error('请先填写讲稿或导入配音')
        const task = store.newTask({ mode: '口播 MP4', project }, source)
        task.message = '等待打开项目预览'
        task.presentation = { title: project.name, route: '#/projects/' + project.id }
        await fs.writeFile(marker(task.id), '', { flag: 'wx' })
        try {
          await store.write(task)
        } catch (e) {
          await fs.rm(marker(task.id), { force: true })
          throw e
        }
        pending.add(task.id)
        changed()
        return task
      }),
    claim: ({ id }) =>
      serial(async () => {
        if (active || !pending.has(id) || (await store.isCanceled(id))) return { claimed: false }
        const task = await store.read(id)
        if (task.status !== 'queued') return { claimed: false }
        const controller = new AbortController()
        const upload = transfer.write(capture(id), 350 * 1024 * 1024, () => {
          if (active?.id === id) active.seen = Date.now()
        })
        const lease = randomUUID()
        try {
          await store.write({ ...task, status: 'running', message: '正在录制口播', startedAt: Date.now() })
        } catch (e) {
          transfer.revoke(upload.id)
          throw e
        }
        active = { id, lease, upload, controller, seen: Date.now(), encoding: false }
        changed()
        return { claimed: true, lease, url: upload.url, project: task.input.project }
      }),
    pulse: (input) => {
      const r = requireLease(input)
      r.seen = Date.now()
      return { ok: true }
    },
    fail: (input) =>
      serial(async () => {
        const r = requireLease(input)
        if (!r.encoding)
          await terminal(
            await store.read(r.id),
            (await store.isCanceled(r.id)) ? 'canceled' : 'interrupted',
            String(input.message || '录制已中断').slice(0, 500),
          )
        return {}
      }),
    finish: (input) =>
      serial(async () => {
        const r = requireLease(input)
        if (r.encoding || !r.upload.parts || r.upload.parts !== input.parts || r.upload.writing)
          throw new Error('录制分片不完整')
        r.encoding = true
        transfer.revoke(r.upload.id)
        const task = await store.read(r.id),
          dir = store.directory(r.id),
          output = path.join(dir, '口播.mp4')
        await store.write({ ...task, message: '正在编码 MP4' })
        changed()
        const signal = r.controller.signal
        const job = (async () => {
          try {
            await run(
              await ffmpeg(dataDir, signal),
              [
                '-nostdin',
                '-hide_banner',
                '-y',
                '-i',
                capture(r.id),
                '-map',
                '0:v:0',
                '-map',
                '0:a:0',
                '-vf',
                'fps=24',
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-crf',
                '21',
                '-pix_fmt',
                'yuv420p',
                '-c:a',
                'aac',
                '-b:a',
                '128k',
                '-movflags',
                '+faststart',
                output,
              ],
              { signal },
            )
            const bytes = (await fs.stat(output)).size
            await serial(async () => {
              if (active !== r) return
              if (await store.isCanceled(r.id)) return terminal(task, 'canceled', '任务已取消')
              await terminal(task, 'succeeded', '口播视频已生成', {
                artifacts: [{ name: '口播.mp4', path: output, kind: 'video' }],
                result: { bytes, projectId: task.input.project.id, version: task.input.project.version },
              })
            })
          } catch (e) {
            await serial(async () => {
              if (active === r) await terminal(task, 'failed', e.message.slice(-2200))
            })
          } finally {
            if ((await store.read(r.id)).status !== 'succeeded') await fs.rm(output, { force: true })
          }
        })()
        executions.add(job)
        void job.finally(() => executions.delete(job)).catch(console.error)
        return { id: r.id }
      }),
    async close() {
      clearInterval(timer)
      await serial(async () => {
        if (active) await terminal(await store.read(active.id), 'interrupted', '工坊已关闭，可重试')
      })
      await Promise.allSettled([...executions])
    },
  }
}
