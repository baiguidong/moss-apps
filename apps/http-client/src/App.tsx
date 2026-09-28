import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Globe2, Plus, Send, Square, Bookmark, Trash2, FlaskConical } from 'lucide-react'
import { METHODS, emptyRequest, type RequestInput, type RequestResult, type Template } from './contracts'
import { loadTemplates, runtimeStatus, send, storeTemplates } from './lib/host'
import { readTemplates, templateRequest } from './lib/templates'
import { userError } from './lib/errors'
import { formatJson } from './core/json'
import { PairEditor } from './components/Fields'
import { Response } from './components/Response'

const requestTabs = [{ id: 'query', name: '参数' }, { id: 'headers', name: '请求头' }, { id: 'body', name: '正文' }, { id: 'auth', name: '鉴权' }, { id: 'options', name: '选项' }]
export function App() {
  const [request, setRequest] = useState(emptyRequest), [result, setResult] = useState<RequestResult | null>(null)
  const [tab, setTab] = useState('query'), [busy, setBusy] = useState(false), [canceling, setCanceling] = useState(false)
  const [error, setError] = useState(''), [status, setStatus] = useState('正在准备…'), [message, setMessage] = useState('')
  const [templates, setTemplates] = useState<Template[]>([]), [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false), [name, setName] = useState(''), [deleteId, setDeleteId] = useState('')
  const controller = useRef<AbortController | null>(null), mounted = useRef(true), dirty = useRef(false)
  const patch = (value: Partial<RequestInput>) => { dirty.current = true; setRequest(current => ({ ...current, ...value })); setResult(null); setError(''); setMessage('') }
  useEffect(() => {
    mounted.current = true
    let pending = false, again = false
    const refresh = async () => {
      if (!mounted.current) return
      if (pending) { again = true; return }
      pending = true
      try { const text = await runtimeStatus(); if (mounted.current) setStatus(text) }
      catch { if (mounted.current) setStatus('暂时无法连接本地服务，请重试') }
      finally { pending = false; if (again && mounted.current) { again = false; void refresh() } }
    }
    void refresh()
    void loadTemplates().then(raw => { if (mounted.current) { setTemplates(readTemplates(raw)); setLoaded(true) } }).catch(() => { if (mounted.current) setError('请求模板读取失败，请重新打开应用后重试。') })
    const off = window.mossApp?.events.on('runtime', () => void refresh())
    window.addEventListener('focus', refresh); window.addEventListener('http-operation', refresh)
    return () => { mounted.current = false; controller.current?.abort(); off?.(); window.removeEventListener('focus', refresh); window.removeEventListener('http-operation', refresh) }
  }, [])
  const replace = (next: RequestInput) => {
    if (busy || (dirty.current && !window.confirm('替换当前请求？尚未保存的输入将被清空。'))) return
    setRequest(structuredClone(next)); setResult(null); setError(''); setMessage(''); setTab('query'); dirty.current = false
  }
  const execute = async (event?: FormEvent) => {
    event?.preventDefault()
    if (controller.current) return
    const active = new AbortController(); controller.current = active
    setBusy(true); setCanceling(false); setError(''); setResult(null); setMessage('')
    try { const value = await send(request, active.signal); if (mounted.current) setResult(value) }
    catch (error) { if (mounted.current) setError(userError(error)) }
    finally { controller.current = null; if (mounted.current) { setBusy(false); setCanceling(false) } }
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || !loaded) return
    setSaving(true); setError('')
    try {
      if (templates.length >= 50) throw new Error('最多保存 50 个模板，请先删除不再使用的模板。')
      if (!name.trim()) throw new Error('请填写模板名称。')
      const next = [...templates, { id: crypto.randomUUID(), name: name.trim().slice(0, 80), request: templateRequest(request) }]
      await storeTemplates(next)
      setTemplates(next); setSaveOpen(false); setMessage('模板已保存；下次使用时填写参数值、正文和鉴权。')
    } catch (error) { setError(userError(error)) } finally { setSaving(false) }
  }
  const remove = async () => {
    if (saving || !loaded) return
    setSaving(true); setError('')
    try { const next = templates.filter(item => item.id !== deleteId); await storeTemplates(next); setTemplates(next); setDeleteId(''); setMessage('模板已删除。') }
    catch (error) { setError(userError(error)) } finally { setSaving(false) }
  }
  const example = () => replace({ ...emptyRequest(), url: 'https://httpbin.org/anything', query: [{ name: 'hello', value: 'Moss', enabled: true }] })
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><Globe2 size={19} /><span>HTTP 调试</span></div>
    <button className="new-request bordered" disabled={busy} onClick={() => replace(emptyRequest())}><Plus size={15} />新建请求</button>
    <div className="collection-title">请求模板 <span>{templates.length}</span></div>
    <nav aria-label="请求模板">{templates.map(item => <div className="template-row" key={item.id}><button disabled={busy} onClick={() => replace(item.request)} title={item.request.url}><span className="method-label">{item.request.method}</span><span className="template-name">{item.name}</span></button><button className="delete-template" disabled={saving} aria-label={`删除模板 ${item.name}`} onClick={() => { setDeleteId(item.id); setSaveOpen(false) }}><Trash2 size={13} /></button></div>)}</nav>
    {!templates.length && <p className="collection-empty">保存常用接口，下次从这里打开。</p>}<div className="sidebar-note">请求与响应不自动保存。</div>
  </aside><div className="main-column"><main>
    <header className="workspace-header"><div><h1>HTTP 调试</h1><p>编辑请求，查看响应。</p></div><div className="header-actions"><button disabled={busy} onClick={example}><FlaskConical size={14} />填入示例</button><button disabled={busy || !loaded || saving} onClick={() => { setName(''); setSaveOpen(true); setDeleteId(''); setError('') }}><Bookmark size={14} />保存模板</button></div></header>
    {saveOpen && <form className="template-dialog" onSubmit={save} aria-label="保存请求模板"><label>模板名称<input autoFocus aria-label="模板名称" maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="例如：获取用户列表" disabled={saving} /></label><p>保存方法、地址和参数名；参数值、正文与鉴权不保存。</p><div><button className="primary" disabled={saving} type="submit">{saving ? '正在保存…' : '确认保存'}</button><button disabled={saving} type="button" onClick={() => setSaveOpen(false)}>取消</button></div></form>}
    {deleteId && <div className="template-dialog" role="group" aria-label="删除请求模板"><p>删除“{templates.find(item => item.id === deleteId)?.name}”模板？</p><div><button className="danger" disabled={saving} onClick={() => void remove()}>确认删除</button><button disabled={saving} onClick={() => setDeleteId('')}>取消</button></div></div>}
    <form className="request-form" onSubmit={execute} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void execute() } }}>
      <div className="request-line"><select aria-label="请求方法" value={request.method} disabled={busy} onChange={e => patch({ method: e.target.value as RequestInput['method'], ...(['GET', 'HEAD'].includes(e.target.value) ? { bodyMode: 'none' as const } : {}) })}>{METHODS.map(method => <option key={method}>{method}</option>)}</select><input aria-label="请求地址" placeholder="https://api.example.com 或 http://localhost:3000" type="text" spellCheck={false} autoComplete="off" value={request.url} maxLength={16384} disabled={busy} onChange={e => patch({ url: e.target.value })} />{busy ? <button type="button" className="bordered" disabled={canceling} onClick={() => { setCanceling(true); controller.current?.abort() }}><Square size={13} />{canceling ? '正在取消…' : '取消请求'}</button> : <button type="submit" className="primary"><Send size={14} />发送请求</button>}</div>
      <fieldset disabled={busy || saving} className="request-panel panel"><legend className="sr-only">请求内容</legend><div className="tabs request-tabs" aria-label="请求内容">{requestTabs.map(item => <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.name}{item.id === 'query' && request.query.filter(row => row.enabled && row.name).length > 0 && <small>{request.query.filter(row => row.enabled && row.name).length}</small>}{item.id === 'headers' && request.headers.filter(row => row.enabled && row.name).length > 0 && <small>{request.headers.filter(row => row.enabled && row.name).length}</small>}</button>)}</div>
        <div className="request-content">
          {tab === 'query' && <><PairEditor label="参数" rows={request.query} onChange={query => patch({ query })} /><p className="hint">参数会追加到 URL；支持同名参数，取消勾选即可暂时停用。</p></>}
          {tab === 'headers' && <><PairEditor label="请求头" rows={request.headers} onChange={headers => patch({ headers })} valuePlaceholder="例如 application/json" /><p className="hint">Content-Type 按正文类型自动补充，也可手动填写。</p></>}
          {tab === 'body' && <><div className="body-options"><label className="inline-field">正文类型<select aria-label="正文类型" value={request.bodyMode} onChange={e => patch({ bodyMode: e.target.value as RequestInput['bodyMode'] })}><option value="none">无</option>{!['GET', 'HEAD'].includes(request.method) && <><option value="json">JSON</option><option value="text">文本</option><option value="form">表单</option></>}</select></label>{request.bodyMode === 'json' && <button type="button" onClick={() => { try { patch({ body: formatJson(request.body) }) } catch (error) { setError(userError(error)) } }}>格式化正文</button>}</div>{request.bodyMode === 'none' ? <p className="inline-empty">{['GET', 'HEAD'].includes(request.method) ? 'GET / HEAD 不发送正文。' : '此请求不包含正文。'}</p> : request.bodyMode === 'form' ? <PairEditor label="表单项" rows={request.form} onChange={form => patch({ form })} /> : <textarea className="body-editor" aria-label="请求正文" spellCheck={false} maxLength={1048576} value={request.body} onChange={e => patch({ body: e.target.value })} placeholder={request.bodyMode === 'json' ? '{\n  "name": "Moss"\n}' : '输入要发送的文本'} />}</>}
          {tab === 'auth' && <div className="auth-fields"><label>鉴权方式<select aria-label="鉴权方式" value={request.auth.type} onChange={e => patch({ auth: { ...request.auth, type: e.target.value as RequestInput['auth']['type'] } })}><option value="none">无鉴权</option><option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option></select></label>{request.auth.type === 'bearer' && <label>Token<input aria-label="Bearer Token" type="password" autoComplete="off" value={request.auth.token} onChange={e => patch({ auth: { ...request.auth, token: e.target.value } })} placeholder="只填 Token，无需 Bearer 前缀" /></label>}{request.auth.type === 'basic' && <><label>用户名<input aria-label="用户名" autoComplete="off" value={request.auth.username} onChange={e => patch({ auth: { ...request.auth, username: e.target.value } })} /></label><label>密码<input aria-label="密码" type="password" autoComplete="off" value={request.auth.password} onChange={e => patch({ auth: { ...request.auth, password: e.target.value } })} /></label></>}<p className="hint">鉴权仅用于当前请求，关闭应用后需重新填写。</p></div>}
          {tab === 'options' && <div className="options-fields"><label className="inline-field">超时<select aria-label="请求超时" value={request.timeoutMs} onChange={e => patch({ timeoutMs: Number(e.target.value) })}>{[1000, 5000, 15000, 30000, 60000, 120000].map(ms => <option key={ms} value={ms}>{ms / 1000} 秒</option>)}</select></label><label className="check"><input type="checkbox" checked={request.followRedirects} onChange={e => patch({ followRedirects: e.target.checked })} />自动跟随重定向</label><p className="hint">最多跳转 10 次。跨站跳转移除鉴权和自定义请求头；不转发跨站正文，不降级 HTTPS。</p></div>}
        </div>
      </fieldset>
    </form>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}
    <Response key={result ? `${result.url}-${result.durationMs}` : 'empty'} result={result} busy={busy} />
  </main><footer className="app-footer"><span>{status}</span><span>本机发送 · 响应上限 1 MiB</span></footer></div></div>
}
