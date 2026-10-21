import { useEffect, useRef, useState } from 'react'
import { AppShell, Artifacts, TaskDetails, TaskHistory, size, useEngineApp } from '@moss/engine-apps/ui'

const labels: Record<string, string> = { trim: '裁剪视频', compress: '压缩视频', audio: '提取 WAV 音频', gif: '生成 GIF', convert: '转换为 MP4' }
export default function App() {
  const state = useEngineApp()
  const player = useRef<HTMLVideoElement>(null)
  const [file, setFile] = useState('')
  const [mode, setMode] = useState('trim')
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [crf, setCrf] = useState(28)
  const inspected = state.tasks.find(task => task.input.mode === 'inspect' && task.input.path === file && task.status === 'succeeded')
  const source = inspected?.artifacts?.[0]
  const duration = Number(inspected?.result?.format?.duration || 0)
  useEffect(() => { if (duration > 0 && end === 0) setEnd(Math.min(duration, 60)) }, [duration, end])
  const pick = async () => {
    const result = await state.invoke('paths.pick', { kind: 'file', multiple: false })
    if (result?.paths?.[0]) { setFile(result.paths[0]); setEnd(0); await state.start({ mode: 'inspect', path: result.paths[0] }) }
  }
  const restore = (input: any) => {
    if (input.path) setFile(input.path)
    if (input.mode && input.mode !== 'inspect') setMode(input.mode)
    setStart(Number(input.start || 0)); setEnd(Number(input.end || 0)); setCrf(Number(input.crf || 28))
  }
  const run = () => void state.start({ mode, path: file, start, end, crf })
  return <AppShell state={state} title="音视频工坊"><div className="two-column">
    <section className="card">
      <div className="section-heading"><h2>输入媒体</h2><button onClick={() => void pick()}>选择文件</button></div>
      <input aria-label="媒体文件路径" value={file} onChange={event => setFile(event.target.value)} placeholder="选择本地音频或视频" style={{ width: '100%' }} />
      {file && <div className="compact-actions"><button onClick={() => void state.start({ mode: 'inspect', path: file })}>读取媒体信息</button></div>}
      {source?.kind === 'video' && <video ref={player} className="media-preview source-preview" src={source.url} controls preload="metadata" style={{ marginTop: 12 }} />}
      {source?.kind === 'audio' && <audio className="media-preview source-preview" src={source.url} controls preload="metadata" style={{ marginTop: 12 }} />}
      {inspected?.result && <p className="workspace-note">{duration ? duration.toFixed(1) + ' 秒' : '时长未知'} · {size(Number(inspected.result.format?.size || 0))} · {(inspected.result.streams || []).map((stream: any) => stream.codec_name).filter(Boolean).join(' / ')}</p>}
      <div className="advanced"><label className="field"><span>处理方式</span><select aria-label="处理方式" value={mode} onChange={event => setMode(event.target.value)}>{Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
        {mode === 'trim' && <><div className="inline-fields time-fields"><label className="field"><span>开始秒数</span><input aria-label="开始秒数" type="number" min={0} step="0.1" value={start} onChange={event => setStart(Number(event.target.value))} /></label><label className="field"><span>结束秒数</span><input aria-label="结束秒数" type="number" min={0} step="0.1" value={end} onChange={event => setEnd(Number(event.target.value))} /></label></div><div className="compact-actions"><button disabled={!player.current} onClick={() => setStart(player.current?.currentTime || 0)}>当前画面设为起点</button><button disabled={!player.current} onClick={() => setEnd(player.current?.currentTime || 0)}>当前画面设为终点</button></div></>}
        {mode === 'compress' && <label className="field" style={{ marginTop: 12 }}><span>压缩强度 · CRF {crf}</span><input aria-label="压缩强度" type="range" min={18} max={40} value={crf} onChange={event => setCrf(Number(event.target.value))} /><small>数值越大，文件通常越小，画质也越低。</small></label>}
        <button className="primary run" disabled={!file || state.busy || mode === 'trim' && end <= start} onClick={run}>{labels[mode] || '开始处理'}</button>
      </div>
    </section>
    <div className="workspace-body"><TaskDetails state={state}>
      {state.task?.result?.bytes != null && <p className="workspace-note">生成文件大小：{size(state.task.result.bytes)}</p>}
      <Artifacts state={state} />
    </TaskDetails><TaskHistory state={state} onRestore={restore} /></div>
  </div></AppShell>
}
