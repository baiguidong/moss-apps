import { setTimeout as wait } from 'node:timers/promises'
import { createAppCapabilitiesClient } from '@moss/app-sdk/app-capabilities'

const appId = 'moss.transcription'
export function createTranscriber(host) {
  const api = createAppCapabilitiesClient(host)
  const names = ['files_import', 'tasks_start', 'workspace_get']
  async function discover(signal) {
    const { tools } = await api.listTools({ appId }, { signal })
    const selected = names.map((name) => tools.find((t) => t.name === name && t.source === 'contribution'))
    if (selected.some((t) => !t)) throw new Error('请在 Moss 安装并启用「语音转写」')
    return selected.map((t) => (args) => api.invokeTool(t.toolRef, args, { signal }))
  }
  return {
    available: () =>
      discover().then(
        () => true,
        () => false,
      ),
    async read(file, signal) {
      const [add, start, workspace] = await discover(signal)
      const imported = await add({ paths: [file] })
      if (!imported.files?.length) throw new Error(imported.errors?.[0]?.message || '导入转写文件失败')
      const task = await start({ fileIds: [imported.files[0].id], options: { language: 'auto' } })
      const deadline = Date.now() + 250_000
      while (Date.now() < deadline) {
        await wait(800, undefined, { signal })
        const snapshot = await workspace({})
        const job = snapshot.tasks.find((t) => t.id === task.id)
        if (!job || ['failed', 'canceled', 'interrupted'].includes(job.status))
          throw new Error(job?.message || '转写任务不可用')
        if (job.status !== 'succeeded') continue
        const item = snapshot.files.find((f) => f.taskId === task.id && f.kind === 'transcript')
        const url = new URL(item?.url)
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('未取得本地转写文件')
        const response = await fetch(url, { signal, redirect: 'error' })
        if (!response.ok || Number(response.headers.get('content-length')) > 4 * 1024 * 1024)
          throw new Error('读取逐字稿失败')
        const { segments } = await response.json()
        const cues = segments
          .filter((s) => typeof s.text === 'string' && s.start >= 0 && s.end > s.start)
          .map(({ start, end, text }) => ({ start, end, text }))
        if (!cues.length) throw new Error('录音中未识别到讲话')
        return { cues, text: cues.map((s) => s.text).join(' ') }
      }
      throw new Error('转写仍在运行，可到语音转写查看任务')
    },
  }
}
