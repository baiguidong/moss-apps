import { useState, type FormEvent } from 'react'
import { ArrowRight, ChevronDown, Eye, EyeOff, Globe2, KeyRound, Loader2, Plus, Radio, Terminal, Trash2 } from 'lucide-react'
import type { McpConfig, McpServer, SaveInput, Transport } from '../contracts'
import { Dialog } from './dialog'
type Row = { id: string; key: string; value: string; saved?: boolean }
const row = (key = '', value = '', saved = false): Row => ({ id: crypto.randomUUID(), key, value, saved })
function Values({ title, rows, onChange }: { title: string; rows: Row[]; onChange: (rows: Row[]) => void }) {
  const [reveal, setReveal] = useState(false)
  return <div className="values-editor"><div className="field-heading"><span>{title}</span><button type="button" className="text-button" onClick={() => setReveal(!reveal)}>{reveal ? <EyeOff size={14} /> : <Eye size={14} />}{reveal ? '隐藏' : '显示'}</button></div>
    {rows.map((item, i) => <div key={item.id} className="value-row"><input aria-label={`${title}名称 ${i + 1}`} placeholder={title === '请求头' ? 'Authorization' : 'API_KEY'} value={item.key} onChange={e => onChange(rows.map(r => r.id === item.id ? { ...r, key: e.target.value } : r))} autoComplete="off" spellCheck={false} /><input aria-label={`${title}值 ${i + 1}`} type={reveal ? 'text' : 'password'} placeholder={item.saved ? '已保存，留空保留' : '输入值'} value={item.value} onChange={e => onChange(rows.map(r => r.id === item.id ? { ...r, value: e.target.value } : r))} autoComplete="new-password" /><button type="button" className="icon-button" aria-label={`删除${title} ${i + 1}`} onClick={() => onChange(rows.filter(r => r.id !== item.id))}><Trash2 size={15} /></button></div>)}
    <button type="button" className="text-button add-value" onClick={() => onChange([...rows, row()])}><Plus size={14} />添加{title === '请求头' ? '请求头' : '变量'}</button>
  </div>
}
export function ServerEditor({ server, onClose, onSave }: { server?: McpServer; onClose: () => void; onSave: (input: SaveInput) => Promise<void> }) {
  const [name, setName] = useState(server?.name || '')
  const [transport, setTransport] = useState<Transport>(server?.config.type || 'http')
  const [url, setUrl] = useState(server?.config.url || '')
  const [command, setCommand] = useState(server?.config.command || '')
  const [args, setArgs] = useState(server?.config.args?.join('\n') || '')
  const [env, setEnv] = useState<Row[]>(() => Object.keys(server?.config.env || {}).map(key => row(key, '', !server?.credentialsMissing)))
  const [headers, setHeaders] = useState<Row[]>(() => Object.keys(server?.config.headers || {}).map(key => row(key, '', !server?.credentialsMissing)))
  const [clientId, setClientId] = useState(String(server?.config.oauth?.clientId || ''))
  const [redirectUri, setRedirectUri] = useState(String(server?.config.oauth?.redirectUri || ''))
  const [disabledTools, setDisabledTools] = useState(server?.config.disabledTools?.join('\n') || '')
  const [enabled, setEnabled] = useState(server?.enabled ?? true)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name.trim())) { setError('服务名称使用字母、数字、连字符或下划线，最多 64 个字符。'); return }
    const config: McpConfig = { type: transport, disabledTools: disabledTools.split('\n').map(v => v.trim()).filter(Boolean) }
    const records = (rows: Row[]) => {
      const active = rows.filter(r => r.key.trim() || r.value)
      if (active.some(r => !r.key.trim())) throw new Error('请为每一项填写名称。')
      if (new Set(active.map(r => r.key.trim())).size !== active.length) throw new Error('变量或请求头名称不能重复。')
      return Object.fromEntries(active.map(r => [r.key.trim(), r.value]))
    }
    try {
      if (transport === 'stdio') {
        if (!command.trim()) throw new Error('请填写启动命令。')
        Object.assign(config, { command: command.trim(), args: args.split('\n').map(v => v.trim()).filter(Boolean), env: records(env) })
      } else {
        let address: URL
        try { address = new URL(url.trim()) } catch { throw new Error('请填写有效的服务地址。') }
        if (!['http:', 'https:'].includes(address.protocol)) throw new Error('服务地址需要使用 http 或 https。')
        Object.assign(config, { url: url.trim(), headers: records(headers) })
        const oauth = { ...server?.config.oauth }
        if (clientId.trim()) oauth.clientId = clientId.trim(); else delete oauth.clientId
        if (redirectUri.trim()) oauth.redirectUri = redirectUri.trim(); else delete oauth.redirectUri
        if (Object.keys(oauth).length) config.oauth = oauth
      }
      setBusy(true)
      await onSave({ name: name.trim(), previousName: server?.name, config, enabled })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
    finally { setBusy(false) }
  }
  return <Dialog title={server ? '编辑连接' : '添加 MCP 服务'} description={server ? '更新连接信息，保留已有的工具与授权配置。' : '选择连接方式，接入你需要的工具。'} onClose={onClose} busy={busy}>
    <form onSubmit={save}><fieldset disabled={busy} className="editor-body">
      <span className="field-heading">连接方式</span><div className="transport-choices" role="group" aria-label="连接方式">
        {([{ id: 'http', label: 'HTTP', description: '远程服务', icon: Globe2 }, { id: 'stdio', label: '本地进程', description: '命令行启动', icon: Terminal }, { id: 'sse', label: 'SSE', description: '兼容旧服务', icon: Radio }] as const).map(item => <button type="button" key={item.id} className={transport === item.id ? 'transport active' : 'transport'} aria-pressed={transport === item.id} onClick={() => setTransport(item.id)}><item.icon size={19} /><strong>{item.label}</strong><small>{item.description}</small></button>)}
      </div>
      <label className="field"><span>服务名称 <small>必填</small></span><input value={name} onChange={e => setName(e.target.value)} placeholder="例如 design-library" autoComplete="off" spellCheck={false} maxLength={64} /><small>用于识别连接及其工具，建议使用简短的英文名称。</small></label>
      {transport === 'stdio' ? <><label className="field"><span>启动命令 <small>必填</small></span><input value={command} onChange={e => setCommand(e.target.value)} placeholder="例如 npx、uvx 或可执行文件路径" autoComplete="off" spellCheck={false} /></label><label className="field"><span>启动参数</span><textarea value={args} onChange={e => setArgs(e.target.value)} placeholder={'每行一个参数\n-y\n@modelcontextprotocol/server-filesystem\n/your/workspace'} spellCheck={false} rows={4} /></label><Values title="环境变量" rows={env} onChange={setEnv} /></> : <><label className="field"><span>服务地址 <small>必填</small></span><input value={url} onChange={e => setUrl(e.target.value)} placeholder={transport === 'http' ? 'https://example.com/mcp' : 'https://example.com/sse'} autoComplete="off" spellCheck={false} /></label><Values title="请求头" rows={headers} onChange={setHeaders} /></>}
      <details className="advanced"><summary><ChevronDown size={15} />高级选项<span>工具与授权</span></summary><div>
        {transport !== 'stdio' && <div className="oauth-fields"><label className="field"><span>OAuth Client ID</span><input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="服务要求时填写" /></label><label className="field"><span>OAuth 回调地址</span><input value={redirectUri} onChange={e => setRedirectUri(e.target.value)} placeholder="通常留空，使用自动发现" /></label></div>}
        <label className="field"><span>不启用的工具</span><textarea rows={2} value={disabledTools} onChange={e => setDisabledTools(e.target.value)} placeholder="每行一个工具名称，可留空" spellCheck={false} /></label>
      </div></details>
      <label className="enable-row"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /><span><strong>启用此服务</strong><small>在后续本地对话中提供工具</small></span></label>
      <p className="security-note"><KeyRound size={14} />凭据加密保存，留空可保留已保存的值。</p>
      {error && <p className="error-message" role="alert">{error}</p>}
    </fieldset><footer className="dialog-footer"><button type="button" className="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}{busy ? '保存中' : server ? '保存更改' : '添加服务'}</button></footer></form>
  </Dialog>
}
