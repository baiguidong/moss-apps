import { createRoot } from 'react-dom/client'
import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import './theme.css'
import './style.css'

declare global { interface Window { mossApp?: AppUiApi } }
type Shot = { id: string; title: string; duration: number; visual?: string; narration?: string }
type Project = { id: string; name: string; width: number; height: number; duration: number; html?: string; purpose?: string; style?: string; templateId?: string; updatedAt?: number; storyboard?: { scenes: Shot[] }; scenes?: { id: string; html: string }[] }
type Artifact = { kind?: string; url?: string; urlError?: string; name?: string }
type Task = { id: string; input?: { projectId?: string; operation?: string; fps?: number }; status?: string; progress?: number; message?: string; artifacts?: Artifact[]; error?: string; createdAt?: number; log?: string }
type Template = { id: string; name: string; purpose?: string }
type Example = { id: string; name: string; tag: string; title: string; subtitle: string; prompt: string; duration: number; aspectRatio: string; visual: string }
const examples: Example[] = [
  { id: 'product-intro', name: '产品介绍', tag: '让亮点被看见', title: 'Meet your\nnext favorite.', subtitle: 'PRODUCT / 01', duration: 15, aspectRatio: '16:9', visual: 'product', prompt: '制作一支 15 秒的「轻听 Air」无线耳机介绍视频，分为轻巧设计、沉浸音质和开始体验三个镜头。使用奶油白与橙色，文字简洁，配合柔和的入场动画。产品与卖点均为演示虚构内容。' },
  { id: 'data-report', name: '数据报告', tag: '让数字讲个故事', title: '+32%', subtitle: 'GROWTH / 02', duration: 15, aspectRatio: '16:9', visual: 'data', prompt: '用 15 秒动画展示一份示例季度报告：营收增长 32%、新增用户 2,400、满意度 96%。以墨绿和浅绿为主色，依次呈现三组数据，结尾给出一句总结。请标注数据为演示数据。' },
  { id: 'lesson', name: '知识讲解', tag: '把复杂变简单', title: 'A little\nmore clarity.', subtitle: 'EXPLAIN / 03', duration: 30, aspectRatio: '9:16', visual: 'lesson', prompt: '做一支 30 秒竖屏科普短片，用生活中的例子讲清「复利」。分为提出问题、举例说明、总结三个镜头，使用清晰的大字和简单图形，配色明亮，避免夸大收益。' },
  { id: 'project-update', name: '项目汇报', tag: '每一步都算数', title: 'Next\nchapter.', subtitle: 'PROGRESS / 04', duration: 15, aspectRatio: '16:9', visual: 'update', prompt: '制作一支 15 秒的项目周报视频。示例内容：完成首页改版、上线搜索功能、下周开始用户测试。用紫色和米白色，以时间线展示进展，结尾突出下一步计划。请标注内容为示例。' },
]
const statusText: Record<string, string> = { queued: '等待渲染', running: '正在渲染', succeeded: '渲染完成', failed: '渲染失败', canceled: '已取消', cancelled: '已取消', interrupted: '任务已中断' }
const isRunning = (task?: Task) => task?.status === 'queued' || task?.status === 'running'
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试'
const unwrapProject = (value: any): Project => value?.project || value
const unwrapTask = (value: any): Task => value?.task || value
const durationText = (seconds: number) => `${Number(seconds.toFixed(1))} 秒`
const routeProject = () => {
  const target = new URLSearchParams(location.hash.split('?')[1] || '').get('target') || location.hash
  return /^#\/projects\/([a-zA-Z0-9_-]{1,64})$/.exec(target)?.[1] || ''
}
async function action(name: string, input: object = {}, signal?: AbortSignal): Promise<any> {
  if (!window.mossApp) throw new Error('请在 Moss 中打开 HyperFrames，即可创建项目和渲染视频。')
  const client = createAppClient(window.mossApp)
  try { return await client.actions.invoke(name, input, { signal }) } finally { client.dispose() }
}
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, up: <path d="M12 19V5m-6 6 6-6 6 6"/>,
    film: <><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 3v18M16 3v18M4 8h4m8 0h4M4 16h4m-4-4h4m8 0h4m-4 4h4"/></>,
    chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1V11.5a9 9 0 0 1 18 0ZM8 10h8m-8 4h5"/>,
    play: <path d="m9 5 11 7-11 7V5Z"/>, check: <path d="m5 12 4 4L19 6"/>, download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>,
    book: <><path d="M12 5v16M12 5C9 2 5 3 3 4v16c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-2-9 1Z"/></>,
    refresh: <path d="M20 7v5h-5M4 17v-5h5m-4-4a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>, edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15v5Z"/></>,
    external: <path d="M14 3h7v7m0-7L11 13M10 3H4v17h17v-6"/>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>, info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.film}</svg>
}
function useTheme() {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    let mode = 'system', backgroundStyle = 'default', disposed = false
    const apply = () => { document.documentElement.dataset.theme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode; document.documentElement.dataset.backgroundStyle = backgroundStyle }
    const sync = async () => {
      try {
        const info = await window.mossApp?.app.getInfo()
        if (disposed) return
        mode = info?.appearance?.themeMode || 'system'; backgroundStyle = typeof info?.appearance?.cssThemeId === 'string' ? info.appearance.cssThemeId : 'default'; apply()
      } catch { if (!disposed) apply() }
    }
    apply(); void sync()
    const off = window.mossApp?.events.on('appearance', () => void sync())
    media.addEventListener('change', apply)
    return () => { disposed = true; off?.(); media.removeEventListener('change', apply) }
  }, [])
}
function ScenePreview({ html, width, height }: { html: string; width: number; height: number }) {
  const element = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const observer = new ResizeObserver(entries => setSize({ width: entries[0].contentRect.width, height: entries[0].contentRect.height }))
    if (element.current) observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  const scale = Math.min(size.width / width, size.height / height)
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`
  const source = `${csp}<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0c1326;color:white;font-family:system-ui}</style>${html}`
  return <div className="scene-viewport" ref={element}><div style={{ width: width * scale, height: height * scale }}><iframe title="当前场景预览" sandbox="" referrerPolicy="no-referrer" srcDoc={source} style={{ width, height, transform: `scale(${scale})` }}/></div></div>
}
function Artwork({ example, large = false }: { example: Example; large?: boolean }) {
  return <div className={`artwork art-${example.visual} ${large ? 'art-large' : ''}`} aria-hidden="true"><span className="art-label">{example.subtitle}</span><strong>{example.title}</strong><div className="art-shapes"><i/><i/><i/><i/></div><span className="art-footer">HYPERFRAMES <span>↗</span></span></div>
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="modal" onCancel={onClose}><div className="section-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><Icon name="close"/></button></div>{children}</dialog>
}
function ShotEditor({ project, shot, onSave, onClose }: { project: Project; shot: Shot; onSave: (value: Project) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(shot), [html, setHtml] = useState(project.scenes?.find(scene => scene.id === shot.id)?.html || '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [sourceDirty, setSourceDirty] = useState(false)
  const save = async () => {
    setBusy(true); setError('')
    try {
      let next = unwrapProject(await action('projects.storyboard.save', { id: project.id, storyboard: { scenes: project.storyboard!.scenes.map(item => item.id === shot.id ? draft : item) } }))
      onSave(next)
      if (sourceDirty) { next = unwrapProject(await action('projects.scene.save', { id: project.id, sceneId: shot.id, html })); onSave(next) }
      onClose()
    } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }
  return <Modal title="编辑分镜" onClose={() => !busy && onClose()}><p className="muted">调整内容后，可带到主会话，让 AI 按新分镜更新画面。</p><label>镜头标题<input maxLength={200} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label><label>画面与动作<textarea maxLength={2000} value={draft.visual || ''} onChange={event => setDraft({ ...draft, visual: event.target.value })}/></label><div className="field-row"><label>时长（秒）<input type="number" min="0.1" max="3600" step="0.1" value={draft.duration} onChange={event => setDraft({ ...draft, duration: Number(event.target.value) })}/></label><label>字幕文案<input maxLength={2000} value={draft.narration || ''} onChange={event => setDraft({ ...draft, narration: event.target.value })}/></label></div><details className="advanced"><summary>高级设置 · 场景 HTML / CSS</summary><p className="muted">支持离线 HTML / CSS。此处修改会直接更新场景源代码。</p><textarea className="code-editor" aria-label="场景源代码" spellCheck={false} value={html} onChange={event => { setHtml(event.target.value); setSourceDirty(true) }}/></details>{error && <p role="alert" className="error-text">{error}</p>}<div className="modal-actions"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !draft.title.trim() || !Number.isFinite(draft.duration) || draft.duration < 0.1 || draft.duration > 3600} onClick={() => void save()}>{busy ? '正在保存…' : '保存修改'}</button></div></Modal>
}
function Guide({ onStart }: { onStart: () => void }) {
  return <section className="guide"><h1>从一句话，到一支视频。</h1><p className="page-description">主会话负责创作，这里负责看见成果。</p><div className="guide-steps">{[
    ['01', '描述你想做的视频', '说清主题、受众和风格，也可以直接选择下方示例。选择画幅与时长，再点击「开始创作」。', 'chat'],
    ['02', '在主会话中一起打磨', 'HyperFrames 会随草稿加入主会话。发送后，AI 使用项目、分镜和场景工具创作；点击会话中的「HyperFrames 工作台」入口可返回 App，查看保存的内容。', 'spark'],
    ['03', '检查画面，渲染成片', '选择分镜检查画面。点击「渲染视频」后在本机生成 MP4，完成后可播放预览并导出到本地。', 'play'],
  ].map(([number, title, description, icon]) => <article key={number}><span className="step-number">{number}</span><Icon name={icon} size={26}/><h2>{title}</h2><p>{description}</p></article>)}</div><button className="primary" onClick={onStart}>开始我的第一支视频 <Icon name="arrow"/></button><div className="guide-about"><h2>HyperFrames 是什么？</h2><p>HyperFrames 是 HeyGen 开源的 HTML 动画与视频渲染项目，采用 Apache-2.0 协议。这个 Moss App 基于 HyperFrames 0.8.200，提供项目、分镜、HTML / CSS 场景、校验、本地渲染和视频导出工具。</p><p>工作台的四个起步示例由此 App 提供。场景预览用于检查布局，最终动画以渲染成片为准。填写字幕文案不会自动合成语音。</p><a href="https://github.com/heygen-com/hyperframes" target="_blank" rel="noreferrer">查看开源项目 <Icon name="external" size={14}/></a></div></section>
}
function App() {
  useTheme()
  const [projects, setProjects] = useState<Project[]>([]), [templates, setTemplates] = useState<Template[]>([]), [tasks, setTasks] = useState<Task[]>([])
  const [projectId, setProjectId] = useState(routeProject), [shotId, setShotId] = useState('')
  const [view, setView] = useState<'workspace' | 'guide'>('workspace'), [previewMode, setPreviewMode] = useState<'scene' | 'video'>('scene')
  const [resultId, setResultId] = useState(''), [result, setResult] = useState<Task | null>(null)
  const [resultError, setResultError] = useState(''), [resultAttempt, setResultAttempt] = useState(0)
  const [prompt, setPrompt] = useState(() => { try { return localStorage.getItem('hyperframes.prompt') || '' } catch { return '' } })
  const [exampleId, setExampleId] = useState('product-intro'), [aspectRatio, setAspectRatio] = useState('16:9'), [duration, setDuration] = useState(15)
  const [fps, setFps] = useState(30), [quality, setQuality] = useState('high')
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null), [loading, setLoading] = useState(!!window.mossApp)
  const [editing, setEditing] = useState<Shot | null>(null), [showRender, setShowRender] = useState(false)
  const [fallbackPrompt, setFallbackPrompt] = useState(''), [validation, setValidation] = useState('')
  const requestVersion = useRef(0), initialized = useRef(false), resultVersion = useRef(0)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLElement>(null)
  const project = projects.find(item => item.id === projectId)
  const example = examples.find(item => item.id === exampleId) || examples[0]
  const shots = project?.storyboard?.scenes || []
  const shot = shots.find(item => item.id === shotId) || shots[0]
  const sceneHtml = project?.storyboard ? project.scenes?.find(item => item.id === shot?.id)?.html || '' : project?.html || ''
  const projectTasks = tasks.filter(task => task.input?.projectId === project?.id)
  const renderTasks = projectTasks.filter(task => task.input?.operation !== 'validate')
  const latest = renderTasks[0]
  const active = renderTasks.find(isRunning)
  const results = renderTasks.filter(task => task.status === 'succeeded' && task.artifacts?.some(item => item.kind === 'video'))
  const selectedResultId = results.some(task => task.id === resultId) ? resultId : results[0]?.id || ''
  const videoArtifactIndex = result?.id === selectedResultId ? result.artifacts?.findIndex(item => item.kind === 'video') ?? -1 : -1
  const videoUrl = result?.artifacts?.[videoArtifactIndex]?.url
  const readyScenes = project?.scenes?.filter(scene => scene.html.trim()).length || 0
  const selectionKey = project?.id || ''
  const selectedTaskText = latest?.error || latest?.message || ''
  const missingDependency = /Cannot find (package|module)|ERR_MODULE_NOT_FOUND/.test(selectedTaskText)
  const selectProject = (id: string) => { const target = id ? `#/projects/${id}` : '#/'; location.hash = location.hash.startsWith('#/workbench') ? `/workbench?target=${encodeURIComponent(target)}` : target; setProjectId(id); setShotId(''); setPreviewMode('scene'); setView('workspace'); setValidation(''); setNotice(null) }
  const viewResult = (id: string) => {
    setResultId(id); setPreviewMode('video')
    if (id === selectedResultId && resultError) setResultAttempt(attempt => attempt + 1)
    previewRef.current?.focus({ preventScroll: true })
    previewRef.current?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  const refresh = useCallback(async () => {
    if (!window.mossApp) { setLoading(false); return }
    const version = ++requestVersion.current
    try {
      const [projectsValue, workspace, templatesValue] = await Promise.all([action('projects.list'), action('workspace.get'), action('templates.list')])
      if (version !== requestVersion.current) return
      const next: Project[] = (projectsValue.projects || []).sort((a: Project, b: Project) => (b.updatedAt || 0) - (a.updatedAt || 0))
      setProjects(next); setTasks(workspace.tasks || []); setTemplates(templatesValue.templates || [])
      if (workspace.registrationError) setNotice({ text: workspace.registrationError, error: true })
      if (!initialized.current) { initialized.current = true; if ((!location.hash || (location.hash.startsWith('#/workbench') && !routeProject())) && next[0]) setProjectId(next[0].id) }
    } catch (error) { if (version === requestVersion.current) setNotice({ text: errorText(error), error: true }) }
    finally { if (version === requestVersion.current) setLoading(false) }
  }, [])
  useEffect(() => {
    void refresh()
    const off = window.mossApp?.events.on('workspace.changed', () => void refresh())
    const hashChanged = () => { setProjectId(routeProject()); setView('workspace') }
    window.addEventListener('hashchange', hashChanged)
    return () => { off?.(); window.removeEventListener('hashchange', hashChanged); ++requestVersion.current }
  }, [refresh])
  const hasActiveTask = tasks.some(isRunning)
  useEffect(() => {
    if (!hasActiveTask) return
    const timer = window.setInterval(() => void refresh(), 1800)
    return () => window.clearInterval(timer)
  }, [hasActiveTask, refresh])
  useEffect(() => {
    const version = ++resultVersion.current
    setResult(null); setResultError('')
    if (!selectedResultId) return
    void action('tasks.get', { id: selectedResultId }).then(value => {
      if (version !== resultVersion.current) return
      const task = unwrapTask(value)
      if (task?.id !== selectedResultId) throw new Error('无法读取成片任务，请重新加载。')
      setResult(task)
      const video = task.artifacts?.find(item => item.kind === 'video')
      if (!video?.url) setResultError(video?.urlError || '暂时无法获取视频地址，请重新加载。')
    }).catch(error => { if (version === resultVersion.current) setResultError(errorText(error)) })
    return () => { ++resultVersion.current }
  }, [selectedResultId, selectionKey, resultAttempt])
  useEffect(() => { try { localStorage.setItem('hyperframes.prompt', prompt) } catch {} }, [prompt])
  const perform = async (name: string, work: () => Promise<void>) => {
    if (busy) return
    setBusy(name); setNotice(null)
    try { await work() } catch (error) { setNotice({ text: errorText(error), error: true }) } finally { setBusy('') }
  }
  const updateProject = (next: Project) => { setProjects(items => [next, ...items.filter(item => item.id !== next.id)]); setValidation('') }
  const useExample = (item: Example) => { setExampleId(item.id); setPrompt(item.prompt); setAspectRatio(item.aspectRatio); setDuration(item.duration); promptRef.current?.focus() }
  const openConversation = () => perform('conversation', async () => {
    if (!window.mossApp?.composer?.prepare) {
      setFallbackPrompt(`请使用 HyperFrames App。${project ? `继续视频项目「${project.name}」，projectId: ${project.id}。` : `创建一支 ${duration} 秒的 ${aspectRatio} 视频。`}\n${prompt || '请帮我构思主题与分镜。'}`)
      return
    }
    await window.mossApp.composer.prepare({ providerId: 'video-projects', intent: project ? 'edit' : 'create', ref: { ...(project ? { projectId: project.id } : { templateId: exampleId, aspectRatio, duration }), prompt } })
    setNotice({ text: '创作草稿已带到主会话，发送后即可开始。' })
  })
  const createSample = () => perform('create', async () => {
    const sizes: Record<string, number[]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] }
    const [width, height] = sizes[aspectRatio]
    const next = unwrapProject(await action('projects.create', { name: `${example.name} · 示例`, templateId: exampleId, aspectRatio, width, height, duration })) as Project
    updateProject(next); selectProject(next.id)
    setNotice({ text: '示例项目已创建。可直接渲染体验，也可带到主会话改成你的内容。' })
  })
  const render = () => project && perform('render', async () => {
    await action('projects.validate', { id: project.id })
    const next = unwrapTask(await action('tasks.start', { operation: 'render', projectId: project.id, fps, quality })) as Task
    setTasks(items => [next, ...items.filter(item => item.id !== next.id)]); setShowRender(false); setPreviewMode('video')
  })
  const exportVideo = () => result && videoArtifactIndex >= 0 && perform('export', async () => {
    const value = await action('artifacts.export', { id: result.id, index: videoArtifactIndex })
    setNotice({ text: value?.canceled ? '已取消导出。' : `视频已导出${value?.path ? `：${value.path}` : '。'}` })
  })
  return <div className="app-shell">
    <aside className="sidebar" aria-label="项目导航"><button className="new-project" onClick={() => selectProject('')}><Icon name="plus"/> 新建视频 <span>↗</span></button><button className={`nav-item ${view === 'workspace' ? 'selected' : ''}`} onClick={() => setView('workspace')}><Icon name="grid"/> 创作工作台</button><div className="nav-label">我的项目 <span>{projects.length.toString().padStart(2, '0')}</span></div><div className="project-list">{projects.map(item => <button title={item.name} key={item.id} className={`project-link ${item.id === project?.id && view === 'workspace' ? 'selected' : ''}`} onClick={() => selectProject(item.id)}><Icon name="film" size={16}/><span>{item.name}<small>{durationText(item.duration)} · {item.width > item.height ? '横屏' : item.width < item.height ? '竖屏' : '方形'}</small></span></button>)}{!projects.length && <p className="nav-empty">{loading ? '正在读取项目…' : '你的第一支视频，\n从一个想法开始。'}</p>}</div><div className="sidebar-bottom"><button className={`nav-item ${view === 'guide' ? 'selected' : ''}`} onClick={() => setView('guide')}><Icon name="book"/> 使用指南 <Icon name="arrow" size={15}/></button></div></aside>
    <main className="main-content"><header className="topbar" data-app-toolbar><div className="workspace-title"><h1>{view === 'guide' ? '使用指南' : project?.name || '视频创作'}</h1>{project && view === 'workspace' && <p>{project.width} × {project.height} · {durationText(project.duration)} · {shots.length ? `${shots.length} 个分镜` : 'HTML 动画项目'}</p>}</div><div className="top-actions">{project && view === 'workspace' && <button className="quiet-button" onClick={() => void openConversation()} disabled={!!busy}><Icon name="chat" size={16}/> 主会话中继续</button>}<button className="icon-button" data-app-secondary-action aria-label="同步项目" title="同步项目" disabled={!!busy || loading} onClick={() => void perform('refresh', refresh)}><Icon name="refresh" size={16}/></button></div></header>
    {notice && <div className={`notice ${notice.error ? 'notice-error' : ''}`} role={notice.error ? 'alert' : 'status'}><Icon name="info" size={17}/><span>{notice.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><Icon name="close" size={16}/></button></div>}
    {!window.mossApp && <div className="standalone-note"><Icon name="info" size={16}/> 当前为界面预览。在 Moss 内打开即可使用主会话和本地视频工具。</div>}
    <div className="page-content">{view === 'guide' ? <Guide onStart={() => selectProject('')}/> : <>
      <div className="creation-layout" data-app-primary><section className="brief-card"><div className="section-heading"><h2><Icon name="spark"/> {project ? '一起打磨这支视频' : '你想做什么视频？'}</h2><span className="small-label">{project ? '继续创作' : '创作需求'}</span></div><p className="card-description">{project ? '描述要调整的内容，AI 会读取当前项目继续创作。' : '主题、风格、想传达的信息，都可以从这里开始。'}</p>{project?.purpose && <div className="project-brief"><span>当前创作目标</span><p>{project.purpose}</p>{project.style && <small>{project.style}</small>}</div>}
        <div className="composer"><textarea ref={promptRef} aria-label="视频创作需求" maxLength={3500} placeholder={project ? '例如：让开场更有冲击力，把第二幕改成产品使用场景…' : '例如：做一支 15 秒的新品介绍，简约温暖的风格，突出设计、音质和日常使用场景…'} value={prompt} onChange={event => setPrompt(event.target.value)}/><div className="composer-context"><span className="app-chip"><span className="mini-mark"><Icon name="film" size={12}/></span> HyperFrames <Icon name="check" size={12}/></span><span>{project ? '已关联当前项目' : '已选择创作 App'}</span></div></div>
        <div className="demo-shortcuts" aria-label="示例快捷输入">{examples.map(item => <button key={item.id} title={item.prompt} className={exampleId === item.id ? 'selected' : ''} onClick={() => useExample(item)}><Icon name="spark" size={11}/>{item.name}</button>)}</div>
        {!project && <div className="brief-controls"><label>画面比例<select aria-label="画面比例" value={aspectRatio} onChange={event => setAspectRatio(event.target.value)}><option value="16:9">▭ 横屏 16:9</option><option value="9:16">▯ 竖屏 9:16</option><option value="1:1">□ 方形 1:1</option></select></label><label>目标时长<select aria-label="目标时长" value={duration} onChange={event => setDuration(Number(event.target.value))}>{[15, 30, 60].map(value => <option key={value} value={value}>{value} 秒</option>)}</select></label></div>}
        <button className="primary conversation-button" disabled={!!busy} onClick={() => void openConversation()}><Icon name="chat"/> {busy === 'conversation' ? '正在准备…' : '开始创作'} <Icon name="arrow" size={17}/></button><p className="composer-hint">进入主会话，自动带上 App{project ? '、当前项目' : ''}与需求，在主会话发送后开始创作。</p><div className="brief-bottom">{project ? <><Icon name="refresh" size={14}/><span>主会话保存的修改会同步到这里</span></> : <><span>想先看看效果？</span><button className="text-button" disabled={!!busy || !templates.some(item => item.id === exampleId)} onClick={() => void createSample()}>{busy === 'create' ? '正在创建…' : '创建示例项目'} <Icon name="arrow" size={14}/></button></>}</div>
      </section>
      <section className="preview-card" id="video-preview" ref={previewRef} tabIndex={-1} aria-label="视频预览"><div className="preview-toolbar">{project ? <div className="tabs" role="tablist" aria-label="预览类型"><button role="tab" aria-selected={previewMode === 'scene'} onClick={() => setPreviewMode('scene')}>场景预览</button><button role="tab" aria-selected={previewMode === 'video'} onClick={() => setPreviewMode('video')}>渲染成片 {results.length > 0 && <span>{results.length}</span>}</button></div> : <span className="preview-label"><span className="live-dot"/> 创意示例</span>}<span className="preview-meta">{project ? `${project.width} × ${project.height}` : '视频示例'}</span></div>
        <div className={`preview-stage ${!project ? 'showcase-stage' : ''}`}>
          {!project ? <div className="showcase"><div className="showcase-grid"/><div className="showcase-card"><Artwork example={example} large/></div><span className="demo-badge">视觉示意 · 非渲染成片</span></div> : previewMode === 'scene' ? sceneHtml ? <ScenePreview html={sceneHtml} width={project.width} height={project.height}/> : <div className="stage-empty"><Icon name="film" size={36}/><h3>这个镜头还在等待创作</h3><p>带到主会话，让 AI 生成并保存场景。</p><button onClick={() => void openConversation()} disabled={!!busy}>去主会话创作 <Icon name="arrow" size={15}/></button></div> : resultError ? <div className="stage-empty" role="alert"><Icon name="info" size={28}/><h3>视频暂时无法播放</h3><p>{resultError}</p><button onClick={() => setResultAttempt(attempt => attempt + 1)}><Icon name="refresh" size={15}/>重新加载视频</button></div> : videoUrl ? <video key={`${selectedResultId}/${resultAttempt}`} className="video-player" controls playsInline preload="metadata" src={videoUrl} onError={() => setResultError('视频加载失败，请重新加载或导出 MP4 查看。')}/> : <div className="stage-empty"><span className={active ? 'render-spinner' : ''}>{!active && <Icon name="play" size={36}/>}</span><h3>{active ? '正在把画面变成视频' : results.length ? '正在载入成片…' : '你的成片将在这里出现'}</h3><p>{active ? '可以继续查看分镜，任务会在后台进行。' : '检查场景后，点击下方「渲染视频」。'}</p></div>}
        </div><div className="preview-footer"><div><Icon name={project ? 'film' : 'spark'} size={15}/><span>{project ? previewMode === 'scene' ? shot?.title || '完整场景' : result ? 'MP4 · 渲染成片' : 'MP4 · 等待生成' : `${example.name} · ${example.tag}`}</span></div><span>{project ? previewMode === 'scene' ? '布局预览 · 动画以成片为准' : result?.id === selectedResultId && result.createdAt ? new Date(result.createdAt).toLocaleString('zh-CN') : '本地渲染' : '从下方示例开始创作 ↙'}</span></div>
        {project && <div className="render-bar"><span className="ready-label"><span className="live-dot"/>{shots.length ? `${readyScenes} / ${shots.length} 场景就绪` : 'HTML 项目'}</span><div className="render-actions">{videoArtifactIndex >= 0 && <button disabled={!!busy} onClick={() => void exportVideo()}><Icon name="download" size={16}/> 导出 MP4</button>}<button className="primary" disabled={!!busy || !!active} onClick={() => setShowRender(true)}><Icon name="play" size={15}/>{active ? '渲染中…' : latest?.status === 'failed' || latest?.status === 'interrupted' ? '重新渲染' : '渲染视频'}</button></div></div>}
      </section></div>
      {project ? <>
        {latest && <section className={`task-status task-${latest.status}`} aria-label="渲染任务"><div className="task-status-line"><span className={active ? 'tiny-spinner' : 'task-symbol'}>{!active && <Icon name={latest.status === 'succeeded' ? 'check' : 'info'} size={18}/>}</span><div><strong>{statusText[latest.status || ''] || '任务状态'}</strong><p>{latest.status === 'failed' ? missingDependency ? '渲染引擎缺少运行依赖，请更新 App 后重新渲染。已保存的项目仍可继续编辑。' : '本次渲染未完成。展开详情查看原因，调整后可重新渲染。' : latest.status === 'succeeded' ? '成片已保存，可在「渲染成片」中查看和导出。' : latest.status === 'interrupted' ? '上次任务已中断，可重新渲染。' : active ? '视频在本机生成，完成后即可预览。' : '你可以随时重新发起渲染。'}</p></div>{active ? <button disabled={!!busy} onClick={() => void perform('cancel', async () => { await action('tasks.cancel', { id: active.id }); await refresh() })}>取消渲染</button> : latest.status === 'succeeded' ? <button className="text-button" aria-controls="video-preview" onClick={() => viewResult(latest.id)}>查看成片 <Icon name="arrow" size={14}/></button> : null}</div>{active && typeof active.progress === 'number' && <progress aria-label="渲染进度" max={1} value={active.progress}/>}<details className="task-details"><summary>任务详情</summary><pre>{selectedTaskText || '暂无日志'}</pre><small>任务 ID：{latest.id}</small></details></section>}
        <section className="storyboard-section"><div className="section-heading"><div><h2>分镜与场景</h2><p className="section-description">选择分镜查看画面，编辑内容后可交给 AI 继续完善。</p></div><span className="small-label">{shots.length ? `${shots.length} 个分镜` : 'HTML 项目'}</span></div>{shots.length ? <div className="shot-strip">{shots.map((item, index) => <button key={item.id} aria-pressed={shot?.id === item.id} className={`shot-card ${shot?.id === item.id ? 'selected' : ''}`} onClick={() => { setShotId(item.id); setPreviewMode('scene') }}><div className={`shot-art shot-art-${index % 4}`}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.title}</strong><small>{durationText(item.duration)}</small></div><div className="shot-caption"><strong>{item.title}</strong><span>{project.scenes?.some(scene => scene.id === item.id && scene.html.trim()) ? '场景就绪' : '待生成'}</span></div></button>)}</div> : <p className="empty-copy">这是完整 HTML 项目。可以在主会话中继续编辑，再渲染为视频。</p>}{shot && <div className="shot-summary"><span className="shot-index">{String(shots.indexOf(shot) + 1).padStart(2, '0')}</span><div><strong>{shot.title}</strong><p>{shot.visual || '尚未填写画面说明'}</p>{shot.narration && <small>文案：{shot.narration}</small>}</div><button disabled={!!busy} onClick={() => setEditing(shot)}><Icon name="edit" size={15}/> 编辑分镜</button></div>}</section>
        {results.length > 0 && <section className="results-section"><div className="section-heading"><h2>渲染记录</h2><span className="small-label">{results.length} 个成片</span></div>{results.map(item => <button className={`result-row ${previewMode === 'video' && selectedResultId === item.id ? 'selected' : ''}`} key={item.id} aria-controls="video-preview" aria-pressed={previewMode === 'video' && selectedResultId === item.id} onClick={() => viewResult(item.id)}><span className="result-icon"><Icon name="play" size={18}/></span><span><strong>{item.artifacts?.find(artifact => artifact.kind === 'video')?.name || 'video.mp4'}</strong><small>{item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '已保存'} · {item.input?.fps || 30} fps</small></span><span className="success-label">已完成</span><span className="result-open">查看视频 <Icon name="arrow" size={16}/></span></button>)}</section>}
      </> : <section className="examples-section"><div className="section-heading"><div><h2>从示例开始</h2><p className="section-description">选择一个方向，创作需求会自动填好。你可以随意修改。</p></div><span className="small-label">4 个起步示例</span></div><div className="example-grid">{examples.map(item => <button className={`example-card ${exampleId === item.id ? 'selected' : ''}`} aria-pressed={exampleId === item.id} key={item.id} onClick={() => useExample(item)}><Artwork example={item}/><div className="example-caption"><div><strong>{item.name}</strong><span>{item.duration} 秒 · {item.aspectRatio}</span></div><span className="example-arrow"><Icon name={exampleId === item.id ? 'check' : 'arrow'} size={16}/></span></div></button>)}</div></section>}
      <footer className="page-footer"><span><Icon name="film" size={14}/> 创意在主会话，成果在这里。</span><button className="text-button" onClick={() => setView('guide')}>了解工作流程 <Icon name="arrow" size={14}/></button></footer>
    </>}</div></main>
    {editing && project && <ShotEditor key={`${project.id}/${editing.id}`} project={project} shot={editing} onSave={updateProject} onClose={() => setEditing(null)}/>}
    {showRender && project && <Modal title="渲染为视频" onClose={() => !busy && setShowRender(false)}><p className="muted">将「{project.name}」的已保存场景渲染为 MP4。</p><div className="render-spec"><Icon name="film" size={23}/><span>{project.width} × {project.height}<small>{durationText(project.duration)} · {shots.length || 1} 个场景</small></span></div><div className="field-row"><label>帧率<select value={fps} onChange={event => setFps(Number(event.target.value))}>{[24, 30, 60].map(value => <option key={value} value={value}>{value} fps</option>)}</select></label><label>画面质量<select value={quality} onChange={event => setQuality(event.target.value)}><option value="high">高质量</option><option value="balanced">均衡</option><option value="fast">快速预览</option></select></label></div>{validation && <p role="status" className="muted">{validation}</p>}{notice?.error && <p role="alert" className="error-text">{notice.text}</p>}<div className="modal-actions"><button disabled={!!busy} onClick={() => void perform('validate', async () => { const value = await action('projects.validate', { id: project.id }); setValidation(value.message || '项目结构校验通过，渲染时将执行引擎检查。') })}>检查项目</button><button className="primary" disabled={!!busy || !!active} onClick={() => void render()}><Icon name="play" size={15}/>{busy === 'render' ? '正在启动…' : '开始渲染'}</button></div></Modal>}
    {fallbackPrompt && <Modal title="在主会话继续创作" onClose={() => setFallbackPrompt('')}><p className="muted">当前宿主暂不支持直接打开主会话。复制下面的需求，在主会话选择 HyperFrames App 后发送。</p><textarea className="fallback-prompt" aria-label="主会话提示" value={fallbackPrompt} readOnly/><div className="modal-actions"><button className="primary" onClick={() => void perform('copy', async () => { await navigator.clipboard.writeText(fallbackPrompt); setNotice({ text: '需求已复制。' }); setFallbackPrompt('') })}>复制创作需求</button></div></Modal>}
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
