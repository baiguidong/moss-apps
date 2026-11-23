import { useEffect, useState } from 'react'
import { labels, type Task } from '@moss/engine-apps/ui'
import type { LocalTask } from '@moss/local-tasks/ui'
import type { Call } from './types'

export type ImageJob = Pick<LocalTask, 'id' | 'title' | 'status' | 'progress' | 'message' | 'createdAt'> & { fileNames: string[]; results: { id: string; name: string; size: number }[] }
const mediaNames: Record<string, string> = {
  animation: '渲染分镜', transcribe: '转写字幕', inspect: '读取媒体信息', trim: '裁剪视频',
  compress: '压缩视频', audio: '提取 WAV', gif: '生成 GIF', convert: '转换 MP4', raw: 'FFmpeg',
}
export const statusText = (status: string) => status === 'canceling' ? '取消中' : labels[status] || status
export const isActive = (status: string) => ['queued', 'running', 'canceling'].includes(status)

export function activityRows(media: Task[], images: ImageJob[]) {
  const mediaRows = media.map(task => {
    const { project, mode, path } = task.input
    const kind = project ? '口播' : mode === 'animation' ? '分镜' : mode === 'transcribe' ? '字幕' : '音视频'
    const operation = project ? '口播出片' : mediaNames[mode] || mode || '处理媒体'
    return { key: 'media-' + task.id, kind, operation, title: project?.name || task.input.projectName || path?.split(/[/\\]/).pop() || operation,
      createdAt: task.createdAt, status: task.status, media: task, image: undefined }
  })
  const imageRows = images.map(task => ({
    key: 'image-' + task.id, kind: '图片', operation: task.title,
    title: task.fileNames[0] ? task.fileNames[0] + (task.fileNames.length > 1 ? ' 等 ' + task.fileNames.length + ' 张' : '') : task.title,
    createdAt: task.createdAt, status: task.status, image: task, media: undefined,
  }))
  return [...mediaRows, ...imageRows].sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))
}
export type ActivityRow = ReturnType<typeof activityRows>[number]

export function useImageActivity(call: Call, enabled: boolean) {
  const [tasks, setTasks] = useState<ImageJob[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!enabled || !window.mossApp) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let fetching = false, pending = false
    const schedule = (delay = 180) => {
      clearTimeout(timer)
      if (!document.hidden) timer = setTimeout(read, delay)
    }
    async function read() {
      if (fetching) { pending = true; return }
      fetching = true
      let retry = false
      try {
        const result = await call('image.tasks.list', {}, controller.signal)
        if (controller.signal.aborted) return
        setTasks(result.tasks)
        setLoaded(true)
        setError('')
        retry = result.tasks.some((t: ImageJob) => isActive(t.status))
      } catch (e) {
        if (!controller.signal.aborted) { setError((e as Error).message); retry = true }
      } finally {
        fetching = false
        if (!controller.signal.aborted && (pending || retry)) schedule(pending ? 0 : 15000)
        pending = false
      }
    }
    const changed = () => {
      if (fetching) pending = true
      else schedule()
    }
    const off = window.mossApp.events.on('image.workspace.changed', changed)
    window.addEventListener('focus', changed)
    document.addEventListener('visibilitychange', changed)
    schedule(0)
    return () => {
      controller.abort()
      clearTimeout(timer)
      off()
      window.removeEventListener('focus', changed)
      document.removeEventListener('visibilitychange', changed)
    }
  }, [call, enabled, revision])
  return { tasks, error, loaded, refresh: () => setRevision(v => v + 1) }
}
