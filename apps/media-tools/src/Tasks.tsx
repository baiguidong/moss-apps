import { TaskDetails, Artifacts, labels, type EngineState } from '@moss/engine-apps/ui'
import { Clock3, RefreshCw } from 'lucide-react'
import type { Call } from './types'
const names: Record<string, string> = {
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
}: {
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
              {!task.input.project && task.input.mode !== 'raw' && (
                <button onClick={() => restore(task.input)}>调整参数</button>
              )}
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
                    else void state.start(task.input)
                  }}
                >
                  重新运行
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
