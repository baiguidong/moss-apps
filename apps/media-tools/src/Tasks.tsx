import { TaskDetails, Artifacts, labels, type EngineState } from '@moss/engine-apps/ui'
import { Clock3, RefreshCw } from 'lucide-react'
import type { Call } from './types'
const names: Record<string, string> = {
  animation: '分镜动画',
  transcribe: '字幕转写',
  inspect: '媒体信息',
  trim: '裁剪视频',
  compress: '压缩视频',
  audio: '提取 WAV',
  gif: '生成 GIF',
  convert: '转换 MP4',
  raw: 'FFmpeg',
}
export function Tasks({
  state,
  call,
  open,
  restore,
  openFeature,
}: {
  openFeature: (tab: '分镜动画' | '转写字幕', id: string) => void
  state: EngineState
  call: Call
  open: (id: string) => void
  restore: (input: any) => void
}) {
  return (
    <div className="studio-grid">
      <section className="editor">
        <div className="row spread">
          <h2>
            <Clock3 size={16} />
            任务记录
          </h2>
          <button aria-label="刷新任务" onClick={() => void state.refresh(true)}>
            <RefreshCw size={15} />
          </button>
        </div>
        {!state.tasks.length && <p className="muted">导出视频或处理媒体后，可在这里查看结果。</p>}
        {state.tasks.map((task) => (
          <div className="job" key={task.id}>
            <button
              className="job-title"
              aria-pressed={state.task?.id === task.id}
              onClick={() => state.setSelected(task.id)}
            >
              <strong>{task.input.project?.name || names[task.input.mode] || task.input.mode}</strong>
              <small>
                {task.input.project ? '口播 MP4 · ' : ''}
                {new Date(task.createdAt).toLocaleString()} · {labels[task.status] || task.status}
              </small>
              <span>{task.message}</span>
            </button>
            <div className="row">
              {!task.input.project && !['raw', 'transcribe', 'animation'].includes(task.input.mode) && (
                <button onClick={() => restore(task.input)}>调整参数</button>
              )}
              {task.input.mode === 'animation' && <button onClick={() => openFeature('分镜动画', task.input.projectId)}>打开分镜</button>}
              {task.input.mode === 'transcribe' && task.status === 'succeeded' && <button onClick={() => openFeature('转写字幕', task.id)}>校对字幕</button>}
              {task.input.project && <button onClick={() => open(task.input.project.id)}>打开项目</button>}
              {['queued', 'running'].includes(task.status) ? (
                <button onClick={() => void state.invoke('tasks.cancel', { id: task.id })}>取消</button>
              ) : (
                <button
                  onClick={() => {
                    if (task.input.project)
                      void call('renders.retry', { id: task.id })
                        .then((result) => {
                          state.setSelected(result.id)
                          open(task.input.project.id)
                        })
                        .catch((e) => state.setError(e.message))
                    else if (task.input.mode === 'transcribe') void state.invoke('media.transcribe', { path: task.input.path, language: task.input.language }).then(job => job && state.setSelected(job.id))
                    else if (task.input.mode === 'animation') openFeature('分镜动画', task.input.projectId)
                    else void state.start(task.input)
                  }}
                >
                  {task.input.mode === 'animation' ? '调整后渲染' : '重新运行'}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
      <TaskDetails state={state}>
        <Artifacts state={state} />
      </TaskDetails>
    </div>
  )
}
