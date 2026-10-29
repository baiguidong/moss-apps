import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Database, Plus, RefreshCw, Pencil, Trash2, PlugZap, X, ShieldCheck } from 'lucide-react'
import { request } from './lib/api'
import { defaults, kinds, type Catalog, type Connection, type Kind, type Settings } from './types'

function Editor({ connection, busy, onClose, onSave }: { connection: Connection | null; busy: boolean; onClose: () => void; onSave: (input: object, test: boolean) => Promise<void> }) {
  const [form, setForm] = useState<Settings>(() => ({ ...Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, connection?.[key as keyof Settings] ?? value])) as Settings, title: connection?.legacy ? '' : connection?.title || '' }))
  const [password, setPassword] = useState(''), [dsn, setDsn] = useState(''), [clearPassword, setClearPassword] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm(current => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('')
    const test = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'test'
    try { await onSave({ ...form, id: connection?.id, password, clearPassword, dsn }, test) }
    catch (error) { setError((error as Error).message) }
  }
  const fields = !['sqlite', 'dsn'].includes(form.kind)
  return <dialog ref={dialog} aria-labelledby="editor-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={event => void submit(event)}>
      <header className="editor-heading"><div><h2 id="editor-title">{connection ? '编辑连接' : '添加数据库连接'}</h2><p>保存后，在会话中选择此 App 即可查询。</p></div><button className="icon" type="button" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18}/></button></header>
      <div className="editor-scroll"><fieldset disabled={busy} className="editor-body">
        <label>连接名称<input autoFocus required maxLength={80} value={form.title} onChange={e => set('title', e.target.value)} placeholder="例如：业务库、订单分析"/></label>
        <label>数据库类型<select value={form.kind} onChange={e => { const kind = e.target.value as Kind; setForm(f => ({ ...f, kind, port: kind === 'postgres' ? 5432 : 3306 })); setPassword(''); setDsn(''); setClearPassword(false) }}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {form.kind === 'sqlite' && <label>数据库文件路径<input aria-label="数据库文件路径" required value={form.file} onChange={e => set('file', e.target.value)} placeholder="已有 .db 或 .sqlite 文件的绝对路径"/><small>使用已有数据库文件，不会自动创建空数据库。</small></label>}
        {form.kind === 'dsn' && <label>连接地址<input aria-label="连接地址" type="password" autoComplete="new-password" value={dsn} onChange={e => setDsn(e.target.value)} placeholder={connection ? '留空保留已保存的连接地址' : '输入完整数据库连接地址'}/><small>支持 PostgreSQL、MySQL、MariaDB、SQL Server、Oracle 和 SQLite。需要 SSL 或其他连接选项时可在地址中填写。</small><code>postgresql://user:password@host:5432/database</code></label>}
        {fields && <>
          <div className="field-grid host-grid"><label>主机地址<input required value={form.host} onChange={e => set('host', e.target.value)} placeholder="localhost"/></label><label>端口<input type="number" min={1} max={65535} required value={form.port} onChange={e => set('port', Number(e.target.value))}/></label></div>
          <div className="field-grid"><label>数据库名称<input required value={form.database} onChange={e => set('database', e.target.value)}/></label><label>用户名<input required autoComplete="off" value={form.username} onChange={e => set('username', e.target.value)}/></label></div>
          <label>密码<input aria-label="密码" type="password" autoComplete="new-password" disabled={clearPassword} value={password} onChange={e => setPassword(e.target.value)} placeholder={connection && !connection.legacy ? '留空保留已保存的密码' : '输入密码；无密码可留空'}/><small>密码加密保存，不会在页面中回显。</small></label>
          {connection && !connection.legacy && <label className="check"><input type="checkbox" checked={clearPassword} onChange={e => { setClearPassword(e.target.checked); setPassword('') }}/>清除已保存的密码</label>}
        </>}
        <div className="query-options"><label className="check"><input type="checkbox" checked={form.readonly} onChange={e => set('readonly', e.target.checked)}/><span>只读查询<small>限制查询工具执行写入操作。</small></span></label>
          {!form.readonly && <p className="warning">此连接允许修改和删除数据库中的数据。</p>}
          <div className="field-grid"><label>最多返回行数<input required type="number" min={1} max={10000} value={form.maxRows} onChange={e => set('maxRows', Number(e.target.value))}/></label><label>查询超时（秒）<input required type="number" min={1} max={300} value={form.timeout} onChange={e => set('timeout', Number(e.target.value))}/></label></div>
          {form.kind === 'sqlite' && <small>SQLite 驱动不使用查询超时选项。</small>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </fieldset></div>
      <footer><button className="button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="button" type="submit" value="save" disabled={busy}>保存</button><button className="button primary" type="submit" value="test" disabled={busy}>{busy ? '正在保存…' : '保存并测试'}</button></footer>
    </form>
  </dialog>
}

function RemoveDialog({ connection, busy, remove, close }: { connection: Connection; busy: boolean; remove: () => void; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="confirm" aria-labelledby="remove-title" onCancel={e => { e.preventDefault(); if (!busy) close() }}><div className="editor-body"><h2 id="remove-title">删除连接</h2><p>删除“{connection.title}”的连接配置？数据库文件和数据会保留。</p></div><footer><button className="button" onClick={close} disabled={busy}>取消</button><button className="button danger" onClick={remove} disabled={busy}>删除连接</button></footer></dialog>
}

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [error, setError] = useState('')
  const [busy, setBusy] = useState(''), [editor, setEditor] = useState<Connection | null | undefined>(), [removing, setRemoving] = useState<Connection | null>(null)
  const [notice, setNotice] = useState(''), [dirty, setDirty] = useState(false)
  useEffect(() => { if (editor === undefined) setDirty(false) }, [editor])
  useEffect(() => { void window.mossApp?.view?.setState({ dirty, busy: Boolean(busy) }).catch(() => {}) }, [dirty, busy])
  const controller = useRef<AbortController | null>(null)
  const load = async () => { setError(''); try { setCatalog(await request('list')) } catch (e) { setError((e as Error).message) } }
  useEffect(() => { void load(); return () => controller.current?.abort() }, [])
  const operate = async (method: string, input: object, id: string) => {
    setError(''); setNotice(''); setBusy(`${method}:${id}`)
    const abort = new AbortController(); controller.current = abort
    try {
      const result = await request(method, input, abort.signal); setCatalog(result)
      if (method === 'inspect') {
        const item = result.connections.find(c => c.id === id)
        setNotice(item?.status === 'connected' ? `“${item.title}”连接成功，已加载 ${item.tools.length} 个工具。` : '')
      }
      return result
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); return null }
    finally { controller.current = null; setBusy('') }
  }
  const save = async (input: object, test: boolean) => {
    setBusy('save'); setError(''); setNotice('')
    let result: Catalog
    try { result = await request('save', input); setCatalog(result); setEditor(undefined); setNotice('连接已保存。') }
    finally { setBusy('') }
    if (test && result.savedId && result.connections.find(c => c.id === result.savedId)?.enabled) await operate('inspect', { id: result.savedId }, result.savedId)
  }
  return <main className="workspace" aria-label="数据库查询" onChangeCapture={() => { if (editor !== undefined) setDirty(true) }}>
    <header className="page-heading" aria-label="连接操作"><span className="muted">{catalog ? `${catalog.connections.length} 个连接` : '正在读取连接'}</span><div className="actions"><button className="icon" aria-label="刷新连接" disabled={!!busy} onClick={() => void load()}><RefreshCw size={17}/></button>{catalog && <button className="button primary" disabled={!!busy} onClick={() => setEditor(null)}><Plus size={16}/>添加连接</button>}</div></header>
    {error && <div className="error banner" role="alert">{error}{!catalog && <button className="button" onClick={() => void load()}>重新加载</button>}</div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!catalog && !error && <p className="empty">正在加载连接…</p>}
    {catalog?.connections.length === 0 && <section className="empty"><Database size={32}/><h2>添加你的第一个数据库连接</h2><p>选择数据库类型，填写连接信息并测试。配置会自动保存，可随时修改。</p></section>}
    <div className="connections">{catalog?.connections.map(connection => {
      const checking = busy === `inspect:${connection.id}`
      const state = !connection.enabled ? '已停用' : connection.status === 'connected' ? '连接正常' : connection.status === 'failed' ? '连接失败' : '待测试'
      return <section className="connection" key={connection.id}>
        <div className="connection-top"><div><div className="title-row"><h2>{connection.title}</h2><span className={`badge ${connection.enabled && connection.status === 'connected' ? 'success' : ''}`}>{checking ? '正在连接…' : state}</span></div><p>{connection.legacy ? '原有配置：编辑连接即可改用页面管理。' : connection.kind === 'sqlite' ? connection.file : connection.kind === 'dsn' ? '连接地址已加密保存' : `${kinds[connection.kind]} · ${connection.host}:${connection.port} / ${connection.database}`}</p></div><label className="check enable"><input type="checkbox" aria-label={`启用 ${connection.title}`} checked={connection.enabled} disabled={!!busy} onChange={e => void operate('set-enabled', { id: connection.id, enabled: e.target.checked }, connection.id)}/>启用</label></div>
        <div className="connection-bottom"><span className="policy">{!connection.legacy && <><ShieldCheck size={14}/>{connection.readonly ? '只读' : '允许写入'} · 最多 {connection.maxRows} 行</>}</span><div className="actions"><button className="button" disabled={!!busy || !connection.enabled} onClick={() => void operate('inspect', { id: connection.id }, connection.id)}><PlugZap size={15}/>{checking ? '正在测试…' : '测试连接'}</button><button className="icon" aria-label={`编辑 ${connection.title}`} disabled={!!busy} onClick={() => setEditor(connection)}><Pencil size={16}/></button><button className="icon" aria-label={`删除 ${connection.title}`} disabled={!!busy} onClick={() => setRemoving(connection)}><Trash2 size={16}/></button></div></div>
        {checking && <p className="muted">首次连接需要下载运行依赖，可能需要几分钟。<button className="text-button" onClick={() => controller.current?.abort()}>取消测试</button></p>}
        {connection.error && connection.enabled && <p className="error" role="alert">{connection.error}</p>}

      </section>
    })}</div>
    {editor !== undefined && <Editor connection={editor} busy={!!busy} onClose={() => setEditor(undefined)} onSave={save}/>}
    {removing && <RemoveDialog connection={removing} busy={!!busy} close={() => setRemoving(null)} remove={() => void operate('remove', { id: removing.id }, removing.id).then(result => { if (result) setRemoving(null) })}/>}
  </main>
}
