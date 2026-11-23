import { useEffect, useRef, useState } from 'react'
import { Captions, Film, FolderOpen, Play } from 'lucide-react'
import type { Call } from './types'
import { size, type Task, type EngineState } from '@moss/engine-apps/ui'

const labels = { trim: '裁剪片段', compress: '压缩视频', audio: '提取 WAV 音频', gif: '生成 GIF', convert: '转换为 MP4', transcribe: '生成字幕' }
type Mode = keyof typeof labels
export type MediaDraft = { path: string; mode: Mode; start: number; end: number | null; crf: number; fps: number; width: number }
export function mediaDraft(input: Partial<MediaDraft> = {}): MediaDraft {
  return { path: input.path || '', mode: input.mode && Object.hasOwn(labels, input.mode) ? input.mode : 'trim',
    start: input.start ?? 0, end: input.end ?? null, crf: input.crf ?? 28, fps: input.fps ?? 10, width: input.width ?? 640 }
}

export function MediaTools({ state, call, draft, change, onTask }: {
  state: EngineState; call: Call; draft: MediaDraft; change: (patch: Partial<MediaDraft>) => void; onTask: (id: string) => void
}) {
  const player = useRef<HTMLMediaElement | null>(null)
  const { path: file, mode, start, end, crf, fps, width } = draft
  const inspected = state.tasks.find(task => task.input.mode === 'inspect' && task.input.path === file && task.status === 'succeeded')
  const [source, setSource] = useState<Task['artifacts'][number]>()
  const getTask = state.getTask, setError = state.setError, inspectId = inspected?.id
  useEffect(() => {
    let active = true
    setSource(undefined)
    if (inspectId) void getTask(inspectId).then(async task => {
      const item = task.artifacts[0]
      if (!item) return
      const url = item.url || (await call('media.preview', { id: inspectId })).url
      if (active) setSource({ ...item, url })
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [inspectId, getTask, setError, call])
  const duration = Number(inspected?.result?.format?.duration || 0)
  const suggestedEnd = Math.min(duration, 60)
  const until = end ?? suggestedEnd
  async function pick() {
    const result = await state.invoke('paths.pick', { kind: 'file', multiple: false })
    const path = result?.paths?.[0]
    if (!path) return
    change({ path, start: 0, end: null })
    await state.start({ mode: 'inspect', path })
  }
  async function run() {
    const path = file.trim()
    const task = mode === 'transcribe'
      ? await state.invoke('media.transcribe', { path, language: 'auto' })
      : await state.start({ mode, path, ...(mode === 'trim' ? { start, end: until } : mode === 'compress' ? { crf } : mode === 'gif' ? { width, fps } : {}) })
    if (task) onTask(task.id)
  }
  const valid = mode === 'trim' ? start >= 0 && until > start && until <= 864000 && (!duration || until <= duration)
    : mode === 'gif' ? Number.isInteger(width) && width >= 64 && width <= 1920 && fps >= 1 && fps <= 30 : true
  const canMark = source?.kind === 'video' || source?.kind === 'audio'
  return <div className="studio-grid media-editor">
    <section className="card">
      <div className="section-heading"><h2>输入媒体</h2>{file && <button disabled={state.busy} onClick={() => void pick()}><FolderOpen size={15} />更换文件</button>}</div>
      {!file && <button className="media-picker" disabled={state.busy} onClick={() => void pick()}><Film size={27} strokeWidth={1.4} /><strong>选择音频或视频</strong></button>}
      <input aria-label="媒体文件路径" value={file} onChange={event => change({ path: event.target.value, start: 0, end: null })} placeholder="或输入本地文件路径" />
      {file && !inspected && <div className="compact-actions"><button disabled={state.busy || !file.trim()} onClick={() => void state.start({ mode: 'inspect', path: file.trim() })}>读取媒体信息</button></div>}
      {source?.kind === 'video' && <video ref={node => { player.current = node }} className="media-preview" src={source.url} controls preload="metadata" />}
      {source?.kind === 'audio' && <audio ref={node => { player.current = node }} className="media-preview" src={source.url} controls preload="metadata" />}
      {inspected?.result && <p className="workspace-note">
        {duration ? duration.toFixed(1) + ' 秒' : '时长未知'} · {size(Number(inspected.result.format?.size || 0))} · {(inspected.result.streams || []).map((s: any) => s.codec_name).filter(Boolean).join(' / ')}
      </p>}
    </section>
    <section className="card">
      <label className="field"><span>处理方式</span><select aria-label="处理方式" value={mode} onChange={e => change({ mode: e.target.value as Mode })}>
        {Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      {mode === 'trim' && <>
        <div className="inline-fields time-fields">
          <label className="field"><span>开始秒数</span><input type="number" min={0} step="any" value={start} onChange={e => change({ start: Number(e.target.value) })} /></label>
          <label className="field"><span>结束秒数</span><input type="number" min={0} step="any" value={until} onChange={e => change({ end: Number(e.target.value) })} /></label>
        </div>
        {canMark && <div className="compact-actions">
          <button onClick={() => change({ start: player.current?.currentTime || 0 })}>当前位置设为起点</button>
          <button onClick={() => change({ end: player.current?.currentTime || 0 })}>当前位置设为终点</button>
        </div>}
        {file && !valid && <p className="workspace-note">结束时间须晚于开始时间{duration ? '，且在素材时长以内' : ''}。</p>}
      </>}
      {mode === 'compress' && <label className="field mode-options"><span>压缩强度 · CRF {crf}</span>
        <input aria-label="压缩强度" type="range" min={18} max={40} value={crf} onChange={e => change({ crf: Number(e.target.value) })} /><small>数值越大，文件通常越小，画质也越低。</small>
      </label>}
      {mode === 'gif' && <div className="inline-fields"><label className="field"><span>动图宽度（像素）</span><input type="number" min={64} max={1920} value={width} onChange={e => change({ width: Number(e.target.value) })} /></label>
        <label className="field"><span>帧率（fps）</span><input type="number" min={1} max={30} value={fps} onChange={e => change({ fps: Number(e.target.value) })} /></label></div>}
      {mode === 'transcribe' && <p className="workspace-note">自动识别语言。完成后可在任务中心校对逐字稿，导出 SRT 或 VTT。</p>}
      <button className="primary run" disabled={!file.trim() || state.busy || !valid} onClick={() => void run()}>
        {mode === 'transcribe' ? <Captions size={16} /> : <Play size={15} />}{labels[mode]}
      </button>
    </section>
  </div>
}
