import { useEffect, useRef, useState } from 'react'
import { AudioLines, Download, Save, Search, Play } from 'lucide-react'
import { Shell, Empty, History, Submit, useWorkspace, bytes, time, type LocalFile } from '@moss/local-tasks/ui'
type Transcript = { revision: string; duration: number; waveform: number[]; language: string; segments: { start: number; end: number; text: string }[] }
export function App() {
  const state = useWorkspace(), inputs = state.workspace.files.filter(f => f.role === 'input'), results = state.workspace.files.filter(f => f.kind === 'transcript')
  const [fileId, setFileId] = useState(''), [language, setLanguage] = useState('auto'), [transcriptId, setTranscriptId] = useState(''), [transcript, setTranscript] = useState<Transcript | null>(null), [query, setQuery] = useState(''), [playhead, setPlayhead] = useState(0), [dirty, setDirty] = useState(false)
  const audio = useRef<HTMLAudioElement>(null), load = useRef(0)
  const selected = inputs.find(f => f.id === fileId) || inputs[0], result = results.find(f => f.id === transcriptId), playback = state.workspace.files.find(f => f.taskId === result?.taskId && f.role === 'output' && f.kind === 'audio')
  async function open(file: LocalFile) {
    if (dirty && !window.confirm('有未保存的校对内容，是否放弃并打开另一份逐字稿？')) return
    const revision = ++load.current
    try { const data = await (await fetch(file.url)).json(); if (revision === load.current) { setTranscriptId(file.id); setTranscript(data); setFileId(data.sourceId); setLanguage(data.language || 'auto'); setDirty(false); setPlayhead(0); setQuery('') } }
    catch { state.setError('逐字稿读取失败，请重试。') }
  }
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [dirty])
  const jump = (second: number) => { if (audio.current) { audio.current.currentTime = second; void audio.current.play().catch(() => {}) } }
  const save = async () => { if (!transcript) return; const result = await state.invoke('transcript.save', { id: transcriptId, revision: transcript.revision, segments: transcript.segments }); if (result) { setTranscript({ ...transcript, revision: result.revision }); setDirty(false); state.setNotice('校对已保存，TXT 和字幕文件已同步更新。') } }
  const exportText = async (ext: string) => { if (dirty) { state.setError('请先保存校对内容，再导出。'); return }; const file = state.workspace.files.find(f => f.taskId === result?.taskId && f.name.endsWith(`.${ext}`)); if (file) await state.exportFiles([file.id]) }
  return <Shell title="语音转写" subtitle="让录音变成可阅读、可校对的文字。" icon={<AudioLines size={24} />} state={state}>
    {!inputs.length ? <Empty title="从一段录音开始" onImport={() => void state.pick()}>选择录音或视频，生成逐字稿和字幕。多语言模型随 App 提供，可直接离线转写。</Empty> : <>
      <div className="workbench"><section className="panel"><div className="section-title"><h2>{transcript ? '逐字稿校对' : '待转写文件'}</h2>{transcript && <div className="row"><small>{dirty ? '有未保存的修改' : '已保存'}</small><button onClick={() => void save()} disabled={!dirty || state.busy}><Save size={15} />保存校对</button></div>}</div>
        {transcript && playback ? <><div className="player"><audio ref={audio} src={playback.url} controls preload="metadata" onTimeUpdate={() => setPlayhead(audio.current?.currentTime || 0)} />
          <svg className="waveform" viewBox="0 0 720 66" role="img" aria-label="录音波形">{transcript.waveform.map((n, i) => <rect key={i} x={i * 4} y={33 - Math.max(2, n * 30)} width="2.5" height={Math.max(4, n * 60)} fill={i / transcript.waveform.length <= playhead / transcript.duration ? 'var(--primary)' : 'var(--border)'} />)}</svg><div className="detail-line"><span>{time(playhead)} / {time(transcript.duration)}</span><span>{transcript.segments.length} 个片段</span></div></div>
          <div className="transcript-search"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索逐字稿" aria-label="搜索逐字稿" /></div>
          <div className="segments">{transcript.segments.map((segment, index) => segment.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && <article className={`segment ${playhead >= segment.start && playhead < segment.end ? 'playing' : ''}`} key={index}><button aria-label={`播放 ${time(segment.start)}`} onClick={() => jump(segment.start)}><Play size={13} />{time(segment.start)}</button><textarea aria-label={`片段 ${index + 1}`} value={segment.text} rows={Math.max(2, Math.ceil(segment.text.length / 50))} onChange={e => { setTranscript({ ...transcript, segments: transcript.segments.map((s, i) => i === index ? { ...s, text: e.target.value } : s) }); setDirty(true) }} /></article>)}{transcript.segments.length === 0 && <p className="muted">未识别到语音，可以播放音频检查内容。</p>}</div>
        </> : <div className="audio-input-list">{inputs.map(f => <button className={`audio-input ${selected?.id === f.id ? 'selected' : ''}`} key={f.id} onClick={() => setFileId(f.id)}><AudioLines size={23} /><span>{f.name}<small>{bytes(f.size)}</small></span></button>)}</div>}
      </section><aside className="panel options"><div className="section-title"><h2>转写设置</h2></div><div className="panel-body"><label className="field"><span>录音 / 视频</span><select value={selected?.id || ''} onChange={e => setFileId(e.target.value)}>{inputs.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select></label><label className="field"><span>语音语言</span><select value={language} onChange={e => setLanguage(e.target.value)}>{[['auto','自动识别'],['zh','中文'],['en','英语'],['ja','日语'],['ko','韩语'],['fr','法语'],['de','德语'],['es','西班牙语']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><small>支持最长 2 小时的文件。转写在本机进行，无需联网下载模型。</small><Submit state={state} disabled={!selected} onClick={() => void state.invoke('tasks.start', { fileIds: [selected.id], options: { language } })}>开始转写</Submit>
        {transcript && <><h3>导出文字和字幕</h3><div className="export-options">{['txt','srt','vtt'].map(ext => <button key={ext} disabled={state.busy || dirty} onClick={() => void exportText(ext)}><Download size={15} />{ext.toUpperCase()}</button>)}</div></>}
      </div></aside></div>
      {!!results.length && <div className="file-list transcript-results">{results.map(f => <button key={f.id} className={transcriptId === f.id ? 'selected' : ''} onClick={() => void open(f)}><AudioLines size={16} />{state.workspace.tasks.find(t => t.id === f.taskId)?.title.replace(/^转写 /, '')}<small>{time(f.metadata.duration)}</small></button>)}</div>}
    </>}<History state={state} onSelect={task => { const file = results.find(f => f.taskId === task.id); if (file) void open(file) }} />
  </Shell>
}
