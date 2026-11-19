import { useCallback, useEffect, useRef, useState } from 'react'
import { createAppClient } from '@moss/app-sdk/ui'
import { AppShell, useEngineApp } from '@moss/engine-apps/ui'
import {
  Clapperboard,
  MessagesSquare,
  AudioLines,
  ListVideo,
  Plus,
  Save,
  Users,
  Settings2,
  Play,
  Square,
  Download,
  Sparkles,
  FolderOpen,
} from 'lucide-react'
import { Stage, type StageHandle } from './Stage'
import { MediaTools } from './MediaTools'
import { Chat } from './Chat'
import { Tasks } from './Tasks'
import { fieldsOf, type Library, type Project, type Call, type Recording } from './types'
import './studio.css'

const empty: Project = {
  id: '',
  version: 0,
  updatedAt: 0,
  name: '未命名口播',
  script: '',
  avatarId: 'moss',
  audioId: '',
  transcriptId: '',
  source: 'script',
  voice: 'Tingting',
  rate: 200,
  aspect: '16:9',
  camera: 'upper',
  background: '#cadbd7',
  subtitles: true,
  quality: '720p',
}
const sections = [
  ['口播', Clapperboard],
  ['对话', MessagesSquare],
  ['媒体处理', AudioLines],
  ['任务', ListVideo],
] as const
type Tab = (typeof sections)[number][0]
function routeId() {
  const hash = location.hash
  const target = hash.startsWith('#/workbench')
    ? new URLSearchParams(hash.split('?')[1]).get('target') || ''
    : hash
  return /^#\/projects\/([a-f0-9-]+)$/.exec(target)?.[1] || ''
}
function writeRoute(id: string) {
  const target = id ? '#/projects/' + id : '#/'
  history.replaceState(
    null,
    '',
    location.hash.startsWith('#/workbench') ? '#/workbench?target=' + encodeURIComponent(target) : target,
  )
}
export default function App() {
  const engine = useEngineApp(),
    client = useRef<ReturnType<typeof createAppClient> | null>(null)
  const call: Call = useCallback(
    (name, input = {}, signal) =>
      client.current?.actions.invoke(name, input, { timeoutMs: 300000, signal }) ||
      Promise.reject(new Error('Moss 后台尚未就绪')),
    [],
  )
  const [mediaInput, setMediaInput] = useState<Record<string, any>>()
  const modal = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<Tab>('口播'),
    [lib, setLib] = useState<Library | null>(null),
    [project, setProject] = useState<Project>(empty),
    [dirty, setDirty] = useState(false)
  const [dialog, setDialog] = useState(''),
    [busy, setBusy] = useState(false),
    [listening, setListening] = useState(false),
    [record, setRecord] = useState<Recording | null>(null)
  const [playing, setPlaying] = useState(false),
    [readyKey, setReadyKey] = useState(''),
    [renamed, setRenamed] = useState(''),
    [stale, setStale] = useState(false),
    [audioUrl, setAudioUrl] = useState('')
  const stage = useRef<StageHandle>(null),
    sound = useRef<AbortController | null>(null),
    claiming = useRef(false),
    initialized = useRef(false),
    projectRef = useRef(project),
    dirtyRef = useRef(dirty),
    selection = useRef(0)
  projectRef.current = project
  dirtyRef.current = dirty
  useEffect(() => {
    if (dialog) modal.current?.showModal()
  }, [dialog])
  const report = engine.setError
  const open = useCallback(
    async (id: string) => {
      const token = ++selection.current
      const next = await call('projects.get', { id })
      if (token !== selection.current) return
      projectRef.current = next
      dirtyRef.current = false
      setProject(next)
      setDirty(false)
      setStale(false)
      writeRoute(id)
    },
    [call],
  )
  const refresh = useCallback(async () => {
    const library: Library = await call('studio.get')
    setLib(library)
    const p = projectRef.current
    if (!initialized.current) {
      initialized.current = true
      const id = routeId() || library.projects[0]?.id
      if (id) await open(id)
      else setProject({ ...empty, avatarId: library.defaultAvatar })
    } else if (p.id && library.projects.some((v) => v.id === p.id && v.version > p.version)) {
      if (dirtyRef.current) setStale(true)
      else await open(p.id)
    }
  }, [call, open])
  useEffect(() => {
    if (!window.mossApp) return
    client.current = createAppClient(window.mossApp)
    void refresh().catch((e) => report(e.message))
    const status = () =>
      void call('transcription.status')
        .then((s) => setListening(s.available))
        .catch(() => setListening(false))
    status()
    window.addEventListener('focus', status)
    const off = client.current.events.on(
      'studio.changed',
      () => void refresh().catch((e) => report(e.message)),
    )
    const hash = () => {
      const id = routeId()
      if (id)
        void open(id)
          .then(() => setTab('口播'))
          .catch((e) => report(e.message))
    }
    window.addEventListener('hashchange', hash)
    return () => {
      window.removeEventListener('hashchange', hash)
      window.removeEventListener('focus', status)
      off()
      sound.current?.abort()
      client.current?.dispose()
      client.current = null
    }
  }, [call, open, refresh, report])
  useEffect(() => {
    setAudioUrl('')
    if (project.source !== 'audio' || !project.audioId) return
    const ctrl = new AbortController()
    void call('audio.preview', { id: project.audioId }, ctrl.signal)
      .then((result) => {
        if (!ctrl.signal.aborted) setAudioUrl(result.url)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) report(e.message)
      })
    return () => ctrl.abort()
  }, [project.source, project.audioId, call, report])
  function edit(patch: Partial<Project>) {
    dirtyRef.current = true
    setDirty(true)
    setProject((p) => ({ ...p, ...patch }))
  }
  async function save() {
    if (project.id && !dirty) return project
    const input = { fields: fieldsOf(project) }
    const saved = project.id
      ? await call('projects.save', { ...input, id: project.id, version: project.version })
      : await call('projects.create', input)
    dirtyRef.current = false
    projectRef.current = saved
    setProject(saved)
    setDirty(false)
    setStale(false)
    writeRoute(saved.id)
    await refresh()
    return saved as Project
  }
  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    report('')
    try {
      await fn()
    } catch (e) {
      report((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function stop() {
    sound.current?.abort()
    sound.current = null
  }
  async function speak(text?: string) {
    stop()
    const ctrl = new AbortController()
    sound.current = ctrl
    setPlaying(true)
    try {
      let track
      if (text !== undefined)
        track = await call(
          'speech.reply',
          { text: text.slice(0, 6000), voice: project.voice, rate: project.rate },
          ctrl.signal,
        )
      else {
        const p = await save()
        track = await call('speech.prepare', { id: p.id, version: p.version }, ctrl.signal)
      }
      ctrl.signal.throwIfAborted()
      if (!stage.current) throw new Error('角色预览尚未就绪')
      await stage.current.play(track, ctrl.signal)
    } catch (e) {
      if (!ctrl.signal.aborted) throw e
    } finally {
      if (sound.current === ctrl || !sound.current) {
        setPlaying(false)
        sound.current = null
      }
    }
  }
  const active = record?.project || project,
    key = [
      active.avatarId,
      active.camera,
      active.aspect,
      active.quality,
      active.background,
      record?.id || 'preview',
    ].join('/')
  const ready = readyKey === key
  const stageReady = useCallback(
    (value: boolean, error?: string) => {
      setReadyKey(value ? key : '')
      if (error && record) {
        void call('renders.fail', { id: record.id, lease: record.lease, message: error }).catch(() => {})
        setRecord(null)
        report(error)
      }
    },
    [key, record, call, report],
  )
  const waiting = engine.tasks
    .filter((t) => t.status === 'queued' && t.input.project?.id === project.id)
    .at(-1)
  useEffect(() => {
    if (
      !waiting ||
      record ||
      claiming.current ||
      playing ||
      busy ||
      tab !== '口播' ||
      !ready ||
      document.hidden
    )
      return
    claiming.current = true
    void call('renders.claim', { id: waiting.id })
      .then((result) => {
        if (result.claimed) setRecord({ id: waiting.id, ...result })
      })
      .catch((e) => report(e.message))
      .finally(() => {
        claiming.current = false
      })
  }, [waiting, record, playing, busy, tab, ready, call, report])
  useEffect(() => {
    if (!record) return
    const lease = { id: record.id, lease: record.lease }
    const timer = setInterval(() => void call('renders.pulse', lease).catch(() => setRecord(null)), 4000)
    const unload = () =>
      void call('renders.fail', { ...lease, message: '录制窗口已关闭或进入后台，可重试' }).catch(() => {})
    const visibility = () => {
      if (document.hidden) {
        unload()
        setRecord(null)
      }
    }
    window.addEventListener('pagehide', unload)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', unload)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [record, call])
  useEffect(() => {
    if (!record || !ready || !stage.current) return
    const ctrl = new AbortController(),
      lease = { id: record.id, lease: record.lease }
    void (async () => {
      try {
        const track = await call('renders.audio', lease, ctrl.signal)
        ctrl.signal.throwIfAborted()
        const parts = await stage.current!.play(track, ctrl.signal, record.url)
        await call('renders.finish', { ...lease, parts }, ctrl.signal)
      } catch (e) {
        await call('renders.fail', { ...lease, message: (e as Error).message }).catch(() => {})
        if (!ctrl.signal.aborted) report((e as Error).message)
      } finally {
        if (!ctrl.signal.aborted) {
          setRecord(null)
          setTab('任务')
          engine.setSelected(record.id)
          void engine.refresh()
        }
      }
    })()
    return () => ctrl.abort()
  }, [record, ready, call, report, engine.setSelected, engine.refresh])
  useEffect(() => {
    if (
      record &&
      engine.tasks.some((t) => t.id === record.id && ['canceled', 'interrupted', 'failed'].includes(t.status))
    )
      setRecord(null)
  }, [record, engine.tasks])
  function switchTab(value: Tab) {
    if (record) return
    stop()
    setTab(value)
    setDialog('')
  }
  async function selectProject(id: string) {
    if (dirty) await save()
    if (id) await open(id)
    else {
      const next = await call('projects.create', {
        fields: { name: '新口播项目', avatarId: lib?.defaultAvatar || 'moss' },
      })
      await open(next.id)
      await refresh()
    }
  }
  async function importAsset(kind: 'avatar' | 'audio') {
    const item = await call('assets.import', { kind })
    if (item.canceled) return
    await refresh()
    edit(kind === 'avatar' ? { avatarId: item.id } : { source: 'audio', audioId: item.id, transcriptId: '' })
    setRenamed(item.name)
  }
  async function exportVideo() {
    const p = await save()
    const task = await call('renders.submit', { id: p.id, version: p.version })
    engine.setSelected(task.id)
    setDialog('')
    await engine.refresh()
  }
  const locked = busy || !!record || playing
  const currentAvatar = lib?.avatars.find((a) => a.id === active.avatarId)
  return (
    <AppShell state={engine} title="音视频工坊">
      <div className="studio">
        <nav className="studio-tabs" aria-label="工作区">
          {sections.map(([label, Icon]) => (
            <button
              key={label}
              aria-current={tab === label ? 'page' : undefined}
              disabled={!!record && tab !== label}
              onClick={() => switchTab(label)}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        {(tab === '口播' || tab === '对话') && (
          <>
            <div className="projectbar">
              <div className="row">
                <FolderOpen size={17} />
                <select
                  aria-label="选择项目"
                  value={project.id}
                  disabled={locked}
                  onChange={(e) => void run(() => selectProject(e.target.value))}
                >
                  {!project.id && <option value="">未命名口播</option>}
                  {lib?.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  disabled={locked}
                  title="新建项目"
                  aria-label="新建项目"
                  onClick={() => void run(() => selectProject(''))}
                >
                  <Plus size={16} />
                </button>
              </div>
              <span className="row">
                <small>
                  {stale
                    ? '有新版本'
                    : dirty
                      ? '待保存'
                      : project.id
                        ? '已保存 · v' + project.version
                        : '新项目'}
                </small>
                {stale && <button onClick={() => void run(() => open(project.id))}>载入最新稿</button>}
                <button disabled={locked || !lib} onClick={() => void run(save)}>
                  <Save size={15} />
                  保存
                </button>
              </span>
            </div>
            <div className="studio-grid">
              <section className="preview-panel">
                <div className="row spread">
                  <h2>角色预览</h2>
                  <button
                    disabled={locked}
                    onClick={() => {
                      setRenamed(currentAvatar?.name || '')
                      setDialog('avatars')
                    }}
                  >
                    <Users size={15} />
                    角色库
                  </button>
                </div>
                <div className="stage-wrap">
                  {lib && <Stage key={key} ref={stage} settings={active} call={call} onReady={stageReady} />}
                </div>
                <div className="preview-foot row spread">
                  <span className="row">
                    <i className={ready ? 'dot ready' : 'dot'} />
                    {record ? '正在录制' : playing ? '正在播报' : ready ? currentAvatar?.name : '正在准备'}
                  </span>
                  <div className="row">
                    <select
                      disabled={locked}
                      aria-label="画幅"
                      value={active.aspect}
                      onChange={(e) => edit({ aspect: e.target.value as Project['aspect'] })}
                    >
                      <option>16:9</option>
                      <option>9:16</option>
                    </select>
                    <select
                      disabled={locked}
                      aria-label="镜头"
                      value={active.camera}
                      onChange={(e) => edit({ camera: e.target.value as Project['camera'] })}
                    >
                      <option value="upper">半身</option>
                      <option value="head">近景</option>
                      <option value="full">全身</option>
                    </select>
                    <button disabled={locked} aria-label="预览设置" onClick={() => setDialog('settings')}>
                      <Settings2 size={16} />
                    </button>
                  </div>
                </div>
                {record && (
                  <div className="row spread recording">
                    请保持预览窗口可见
                    <button onClick={() => void engine.invoke('tasks.cancel', { id: record.id })}>
                      取消录制
                    </button>
                  </div>
                )}
              </section>
              {tab === '口播' ? (
                <section className="editor">
                  <div className="row spread">
                    <h2>口播内容</h2>
                    <button
                      disabled={locked || !lib}
                      onClick={() =>
                        void run(async () => {
                          const p = await save()
                          const result = await window.mossApp.composer.prepare({
                            providerId: 'studio-projects',
                            intent: 'edit',
                            ref: { projectId: p.id },
                            prompt: '请读取当前口播项目并帮我撰写或润色讲稿。',
                          })
                          if (result?.ok === false)
                            throw new Error(result.error?.message || '无法打开 Moss 草稿')
                        })
                      }
                    >
                      <Sparkles size={15} />让 Moss 写讲稿
                    </button>
                  </div>
                  <fieldset disabled={locked || !lib}>
                    <label>
                      项目名称
                      <input
                        maxLength={100}
                        value={project.name}
                        onChange={(e) => edit({ name: e.target.value })}
                      />
                    </label>
                    <div className="segmented">
                      {(['script', 'audio'] as const).map((v, i) => (
                        <button
                          key={v}
                          aria-pressed={v === project.source}
                          onClick={() => edit({ source: v })}
                        >
                          {['输入讲稿', '导入配音'][i]}
                        </button>
                      ))}
                    </div>
                    {project.source === 'script' ? (
                      <>
                        <label>
                          讲稿
                          <textarea
                            aria-label="口播讲稿"
                            rows={8}
                            placeholder="输入角色要说的话，标点会自然分段。"
                            maxLength={6000}
                            value={project.script}
                            onChange={(e) => edit({ script: e.target.value })}
                          />
                        </label>
                        <div className="row spread hint">
                          <span>{project.script.length} / 6000 字</span>
                          <span>
                            约 {Math.ceil((project.script.replace(/\s/g, '').length * 60) / project.rate)} 秒
                          </span>
                        </div>
                        <div className="fields">
                          <label>
                            系统音色
                            <select value={project.voice} onChange={(e) => edit({ voice: e.target.value })}>
                              {lib?.voices.map((v) => (
                                <option key={v.name + '-' + v.locale} value={v.name}>
                                  {v.name} · {v.locale}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            语速 · {project.rate}
                            <input
                              type="range"
                              aria-label="语速"
                              min={100}
                              max={350}
                              step={5}
                              value={project.rate}
                              onChange={(e) => edit({ rate: +e.target.value })}
                            />
                          </label>
                        </div>
                        <small>macOS 系统音色用于个人非商业创作，商用可导入已授权配音。</small>
                      </>
                    ) : (
                      <>
                        <label>
                          配音文件
                          <select
                            aria-label="配音文件"
                            value={project.audioId}
                            onChange={(e) => edit({ audioId: e.target.value, transcriptId: '' })}
                          >
                            <option value="">选择音轨</option>
                            {lib?.audio.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button onClick={() => void run(() => importAsset('audio'))}>
                          <FolderOpen size={15} />
                          选择配音文件
                        </button>
                        {audioUrl && (
                          <audio aria-label="配音音轨" src={audioUrl} controls preload="metadata" />
                        )}
                        {project.audioId && (
                          <button
                            disabled={!listening}
                            title={listening ? '使用已安装的语音转写' : '请先安装并启用语音转写'}
                            onClick={() =>
                              void run(async () => {
                                const p = await save()
                                const saved = await call('audio.transcribe', { id: p.id, version: p.version })
                                await open(saved.id)
                              })
                            }
                          >
                            {project.transcriptId ? '重新生成字幕' : '转写配音字幕'}
                          </button>
                        )}
                      </>
                    )}
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={project.subtitles}
                        disabled={project.source === 'audio' && !project.transcriptId}
                        onChange={(e) => edit({ subtitles: e.target.checked })}
                      />
                      显示字幕
                    </label>
                  </fieldset>
                  <div className="actions">
                    <button
                      disabled={!ready || busy || !!record}
                      onClick={() => (playing ? stop() : void speak().catch((e) => report(e.message)))}
                    >
                      {playing ? <Square size={15} /> : <Play size={15} />} {playing ? '停止' : '试听'}
                    </button>
                    <button
                      className="primary"
                      disabled={
                        !ready ||
                        locked ||
                        (project.source === 'script' ? !project.script.trim() : !project.audioId)
                      }
                      onClick={() => setDialog('export')}
                    >
                      <Download size={16} />
                      导出 MP4
                    </button>
                  </div>
                </section>
              ) : (
                <Chat
                  key={project.avatarId}
                  avatarId={project.avatarId}
                  call={call}
                  report={report}
                  speak={speak}
                  stopAudio={stop}
                  speaking={playing}
                  canListen={listening}
                  useScript={(script) => {
                    stop()
                    edit({ script, source: 'script' })
                    setTab('口播')
                  }}
                />
              )}
            </div>
          </>
        )}
        {tab === '媒体处理' && (
          <MediaTools initial={mediaInput} state={engine} onTask={() => switchTab('任务')} />
        )}
        {tab === '任务' && (
          <Tasks
            restore={(input) => {
              setMediaInput(input)
              switchTab('媒体处理')
            }}
            state={engine}
            call={call}
            open={(id) =>
              void run(async () => {
                if (dirty) await save()
                await open(id)
                switchTab('口播')
              })
            }
          />
        )}
        {dialog && (
          <dialog
            ref={modal}
            onCancel={() => setDialog('')}
            aria-label={dialog === 'avatars' ? '角色库' : dialog === 'settings' ? '预览设置' : '导出设置'}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDialog('')
            }}
          >
            <div className="row spread">
              <h2>{dialog === 'avatars' ? '角色库' : dialog === 'settings' ? '预览设置' : '导出设置'}</h2>
              <button onClick={() => setDialog('')}>关闭</button>
            </div>
            {dialog === 'avatars' ? (
              <>
                <label>
                  当前角色
                  <select
                    value={project.avatarId}
                    disabled={busy}
                    onChange={(e) => {
                      edit({ avatarId: e.target.value })
                      setRenamed(lib?.avatars.find((a) => a.id === e.target.value)?.name || '')
                    }}
                  >
                    {lib?.avatars.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {lib.defaultAvatar === a.id ? ' · 默认' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  角色名称
                  <input value={renamed} maxLength={100} onChange={(e) => setRenamed(e.target.value)} />
                </label>
                <div className="row">
                  <button
                    disabled={busy || !renamed.trim()}
                    onClick={() =>
                      void run(async () => {
                        await call('avatars.edit', { id: project.avatarId, name: renamed })
                        await refresh()
                      })
                    }
                  >
                    重命名
                  </button>
                  <button
                    disabled={busy || project.avatarId === lib?.defaultAvatar}
                    onClick={() =>
                      void run(async () => {
                        await call('avatars.edit', { id: project.avatarId, makeDefault: true })
                        await refresh()
                      })
                    }
                  >
                    设为默认
                  </button>
                </div>
                <div className="row">
                  <button disabled={busy} onClick={() => void run(() => importAsset('avatar'))}>
                    导入 GLB
                  </button>
                  <button
                    disabled={!ready || playing}
                    onClick={() => {
                      setDialog('')
                      void speak('你好，我是' + (currentAvatar?.name || '小墨') + '。').catch((e) =>
                        report(e.message),
                      )
                    }}
                  >
                    试播角色
                  </button>
                </div>
              </>
            ) : (
              <>
                <label>
                  背景颜色
                  <input
                    type="color"
                    value={project.background}
                    onChange={(e) => edit({ background: e.target.value })}
                  />
                </label>
                <label>
                  导出画质
                  <select
                    value={project.quality}
                    onChange={(e) => edit({ quality: e.target.value as Project['quality'] })}
                  >
                    <option value="720p">720p · 24 fps</option>
                    <option value="480p">480p · 低负载</option>
                  </select>
                </label>
                {dialog === 'export' && (
                  <>
                    <p>{project.aspect} · H.264 / AAC。视频生成后，可在任务里预览并选择保存位置。</p>
                    <button className="primary" disabled={busy} onClick={() => void run(exportVideo)}>
                      开始导出
                    </button>
                  </>
                )}
              </>
            )}
          </dialog>
        )}
      </div>
    </AppShell>
  )
}
