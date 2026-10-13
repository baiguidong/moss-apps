import * as React from 'react';
import { Check, Code2, Globe2, KeyRound, Pencil, Plus, RefreshCw, Terminal, Wrench, X } from 'lucide-react';
import { Button, Input } from './primitives';
import { cleanIpcErrorMessage, api } from './api';
import type { AppMcpServiceSettings, AppMcpSettingsMethod, McpHostInputMap, StoredApp } from './types';
import type { McpConfig } from '@moss/app-sdk/mcp';

const statusLabels: Record<AppMcpServiceSettings['status'], string> = {
  'app-disabled': 'App 已停用', 'instance-disabled': '后台已停用', unauthorized: '未授权', disabled: '已停用',
  'credentials-missing': '需补充凭据', unchecked: '未检查', authorized: '已授权', connected: '检查通过',
  'needs-auth': '需要授权', failed: '连接失败',
};
type Save = (method: AppMcpSettingsMethod, input: McpHostInputMap[AppMcpSettingsMethod]) => Promise<void>;

function ConnectionEditor({ server, saving, onSave, onCancel }: { server: AppMcpServiceSettings; saving: boolean; onSave: Save; onCancel: () => void }) {
  const [config, setConfig] = React.useState<McpConfig>(() => structuredClone(server.config));
  const [credentials, setCredentials] = React.useState(() => Object.entries(server.config.type === 'stdio' ? server.config.env || {} : server.config.headers || {}));
  const [error, setError] = React.useState('');
  const local = config.type === 'stdio';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try {
      const keys = credentials.map(([name]) => name.trim());
      if (keys.some(key => !key) || new Set(keys).size !== keys.length) throw new Error('凭据名称不能为空或重复。');
      await onSave('servers.save', { name: server.name, previousName: server.name, enabled: server.enabled,
        config: { ...config, [local ? 'env' : 'headers']: Object.fromEntries(credentials.map(([, value], index) => [keys[index], value])) } });
      onCancel();
    } catch (cause) { setError(cleanIpcErrorMessage(cause)); }
  };
  return <form onSubmit={event => void submit(event)} className="space-y-4 p-4">
    <fieldset disabled={saving} className="space-y-4">
      <label className="grid gap-2 text-xs font-medium">{local ? '启动命令' : '服务地址'}
        <Input required value={local ? config.command || '' : config.url || ''} onChange={event => setConfig({ ...config, [local ? 'command' : 'url']: event.target.value })} />
      </label>
      {local && <div className="space-y-2"><div className="text-xs font-medium">启动参数</div>
        {(config.args || []).map((arg, index) => <div className="flex gap-2" key={index}>
          <Input aria-label={`启动参数 ${index + 1}`} value={arg} onChange={event => setConfig({ ...config, args: config.args!.map((value, i) => i === index ? event.target.value : value) })} />
          <Button type="button" variant="ghost" size="icon" aria-label={`删除启动参数 ${index + 1}`} onClick={() => setConfig({ ...config, args: config.args!.filter((_, i) => i !== index) })}><X className="h-4 w-4" /></Button>
        </div>)}
        <Button type="button" variant="outline" size="sm" onClick={() => setConfig({ ...config, args: [...config.args || [], ''] })}><Plus className="h-3.5 w-3.5" />添加参数</Button>
      </div>}
      <div className="space-y-2"><div className="text-xs font-medium">{local ? '环境变量' : '请求头'}</div>
        <p className="text-xs text-muted-foreground">已有凭据留空保留原值，删除整行可移除。</p>
        {credentials.map(([name, value], index) => <div className="flex flex-wrap gap-2" key={index}>
          <Input className="min-w-0 flex-1" aria-label={`凭据名称 ${index + 1}`} value={name} onChange={event => setCredentials(credentials.map((pair, i) => i === index ? [event.target.value, value] : pair))} />
          <Input className="min-w-0 flex-1" type="password" autoComplete="new-password" aria-label={`凭据值 ${index + 1}`} placeholder="留空保留已保存的值" value={value} onChange={event => setCredentials(credentials.map((pair, i) => i === index ? [name, event.target.value] : pair))} />
          <Button type="button" variant="ghost" size="icon" aria-label={`删除凭据 ${index + 1}`} onClick={() => setCredentials(credentials.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button>
        </div>)}
        <Button type="button" variant="outline" size="sm" onClick={() => setCredentials([...credentials, ['', '']])}><Plus className="h-3.5 w-3.5" />添加{local ? '环境变量' : '请求头'}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={onCancel}>取消</Button><Button type="submit" size="sm">{saving ? '保存中…' : '保存连接'}</Button></div>
    </fieldset>
  </form>;
}

function ServiceDetails({ app, server, busy, run }: { app: StoredApp; server: AppMcpServiceSettings; busy: boolean; run: Save }) {
  const [tab, setTab] = React.useState<'tools' | 'config'>('config');
  const [editing, setEditing] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const local = server.config.type === 'stdio';
  const available = Boolean(app.enabled && !['app-disabled', 'instance-disabled', 'unauthorized'].includes(server.status));
  const manage = available && app.grants?.includes('mcp:manage');
  const connect = available && app.grants?.includes('mcp:connect');
  const auth = available && app.grants?.includes('mcp:auth');
  const discovered = React.useRef('');
  React.useEffect(() => {
    const revision = `${server.name}/${server.updatedAt}`;
    if (tab !== 'tools' || busy || !connect || !server.enabled || !['unchecked', 'authorized'].includes(server.status) || discovered.current === revision) return;
    discovered.current = revision;
    void run('servers.inspect', { name: server.name }).catch(() => {});
  }, [tab, busy, connect, server.name, server.updatedAt, server.enabled, server.status, run]);
  const act = (method: AppMcpSettingsMethod, input: McpHostInputMap[AppMcpSettingsMethod]) => { void run(method, input).catch(() => {}); };
  const tools = server.tools.filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()));
  const Icon = local ? Terminal : Globe2;
  return <div className="min-w-0 rounded-xl border border-border" data-mcp-service={server.name}>
    <header className="flex flex-wrap items-center gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="break-all font-semibold">{server.name}</h4><span role="status" className={`rounded-md px-2 py-1 text-xs ${server.status === 'connected' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{statusLabels[server.status]}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{local ? server.config.command : server.config.url}</p></div>
      <Button variant="ghost" size="icon" aria-label={`编辑 ${server.name} 连接`} disabled={busy || !manage} onClick={() => { setTab('config'); setEditing(true); }}><Pencil className="h-4 w-4" /></Button>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4">
      <div className="flex items-center gap-2 text-sm"><button type="button" role="switch" aria-label={`启用 ${server.name}`} aria-checked={server.enabled} disabled={busy || !manage}
        onClick={() => act('servers.set-enabled', { name: server.name, enabled: !server.enabled })} className={`relative h-5 w-9 shrink-0 rounded-full disabled:opacity-50 ${server.enabled ? 'bg-primary' : 'bg-muted-foreground'}`}>
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background" style={{ transform: server.enabled ? 'translateX(16px)' : undefined }} />
        </button>{server.enabled ? '已启用' : '已停用'}</div>
      <Button variant="outline" size="sm" disabled={busy || !connect || !server.enabled || server.credentialsMissing} onClick={() => act('servers.inspect', { name: server.name })}><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />{busy ? '处理中…' : '检查连接'}</Button>
    </div>
    <div role="tablist" aria-label="连接详情" className="flex gap-4 border-b border-border px-4">
      {([{ id: 'tools', title: '可用工具', icon: Wrench }, { id: 'config', title: '连接配置', icon: Code2 }] as const).map(item => <button type="button" role="tab" key={item.id} aria-selected={tab === item.id}
        className={`flex items-center gap-2 border-b-2 py-3 text-sm ${tab === item.id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab(item.id)}><item.icon className="h-4 w-4" />{item.title}{item.id === 'tools' && <span className="rounded bg-muted px-1.5 text-xs">{server.tools.length}</span>}</button>)}
    </div>
    {tab === 'config' ? <div role="tabpanel" aria-label="连接配置">
      {editing ? <ConnectionEditor key={`${server.updatedAt}/${server.enabled}`} server={server} saving={busy} onSave={run} onCancel={() => setEditing(false)} /> : <div className="space-y-4 p-4">
        <div className="flex items-center justify-between"><h5 className="text-sm font-semibold">连接信息</h5><Button variant="ghost" size="sm" disabled={busy || !manage} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />编辑</Button></div>
        <dl className="text-sm">{[
          ['连接方式', local ? '本地进程 · stdio' : server.config.type === 'http' ? 'HTTP · Streamable HTTP' : 'SSE'],
          [local ? '启动命令' : '服务地址', local ? server.config.command : server.config.url],
          ...(local ? [['启动参数', server.config.args?.join('\n') || '无']] : []),
          ['最近修改', new Date(server.updatedAt).toLocaleString('zh-CN')],
        ].map(([name, value]) => <div key={name} className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 border-b border-border py-3"><dt className="text-muted-foreground">{name}</dt><dd className="whitespace-pre-wrap break-all">{value}</dd></div>)}</dl>
        <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="text-sm font-semibold">{local ? '环境变量' : '请求头'}</h5><span className="flex items-center gap-1 text-xs text-muted-foreground"><KeyRound className="h-3.5 w-3.5" />已隐藏敏感值</span></div>
        <div className="rounded-lg border border-border px-3 py-2 text-xs">{Object.keys(local ? server.config.env || {} : server.config.headers || {}).length
          ? Object.keys(local ? server.config.env || {} : server.config.headers || {}).map(name => <div key={name} className="flex justify-between gap-3 py-2"><code className="break-all">{name}</code><span>••••••••</span></div>)
          : <p className="py-2 text-muted-foreground">未配置额外凭据</p>}</div>
        {!local && <Button variant="outline" size="sm" disabled={busy || !auth} onClick={() => act('auth.start', { name: server.name })}><KeyRound className="h-3.5 w-3.5" />浏览器授权</Button>}
      </div>}
    </div> : <div role="tabpanel" aria-label="可用工具" className="space-y-3 p-4">
      {server.tools.length > 0 && <Input aria-label="搜索工具" placeholder="查找工具" value={query} onChange={event => setQuery(event.target.value)} />}
      {tools.map(tool => <div key={tool.name} className="border-b border-border py-3 last:border-0"><div className="flex items-center gap-2"><Wrench className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="break-all text-sm font-medium">{tool.name}</span>{tool.disabled && <span className="shrink-0 text-xs text-muted-foreground">已排除</span>}</div><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{tool.description || '此工具未提供描述。'}</p></div>)}
      {!tools.length && <p className="py-5 text-center text-xs leading-6 text-muted-foreground">{query ? '没有匹配的工具' : server.status === 'connected' ? '服务已连接，目前没有提供工具。' : '检查连接后，这里会展示可用工具及使用说明。'}</p>}
      {server.check?.checkedAt && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" />检查于 {new Date(server.check.checkedAt).toLocaleString('zh-CN')}{server.truncated ? ` · 仅展示前 ${server.tools.length} 项` : ''}</p>}
    </div>}
    {server.error && <p role="alert" className="break-words px-4 pb-4 text-xs text-destructive">{server.error}</p>}
  </div>;
}

export function AppMcpSettings({ app }: { app: StoredApp }) {
  const [servers, setServers] = React.useState<AppMcpServiceSettings[] | null>(null);
  const [selected, setSelected] = React.useState('');
  const [loading, setLoading] = React.useState(true), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const sequence = React.useRef(0), pending = React.useRef(false);
  const appId = app.id || app.name;
  const load = React.useCallback(async () => {
    if (pending.current) return;
    const version = ++sequence.current; setLoading(true);
    try {
      const result = await api.listMcpServers();
      if (version === sequence.current) { setServers(result); setError(''); }
    } catch (cause) { if (version === sequence.current) setError(cleanIpcErrorMessage(cause)); }
    finally { if (version === sequence.current) setLoading(false); }
  }, [appId]);
  React.useEffect(() => {
    void load();
    // Update connection status without discarding an in-progress form on each runtime event.
    return () => { ++sequence.current; };
  }, [load]);
  const identity = (server: AppMcpServiceSettings) => server.name;
  const server = servers?.find(item => identity(item) === selected) || servers?.[0];
  const run: Save = async (method, input) => {
    if (!server || pending.current) throw new Error('请等待当前操作完成。');
    pending.current = true; const version = ++sequence.current; setBusy(true); setError('');
    try {
      const result = await api.updateMcpServer(method, input);
      if (version === sequence.current) setServers(result);
    } catch (cause) { if (version === sequence.current) setError(cleanIpcErrorMessage(cause)); throw cause; }
    finally { pending.current = false; if (version === sequence.current) { setBusy(false); setLoading(false); } }
  };
  return <section className="space-y-3" aria-label="MCP 服务设置">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">MCP 服务</h3><Button variant="ghost" size="sm" disabled={busy || loading} onClick={() => void load()}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />刷新服务</Button></div>
    {error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}
    {servers && servers.length > 1 && <select aria-label="选择 MCP 服务" value={server ? identity(server) : ''} disabled={busy} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" onChange={event => setSelected(event.target.value)}>
      {servers.map(item => <option key={identity(item)} value={identity(item)}>{item.name}</option>)}
    </select>}
    {server ? <ServiceDetails key={identity(server)} app={app} server={server} busy={busy || loading} run={run} />
      : <p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">{loading ? '正在读取服务…' : '此 App 尚未注册 MCP 服务。完成应用配置后可在这里查看。'}</p>}
  </section>;
}
