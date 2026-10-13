import * as React from 'react';
import { api, cleanIpcErrorMessage } from './api';
import type { AppToolScopeSettings, StoredApp } from './types';

export function ToolScopeSettings({ app }: { app: StoredApp }) {
  const [settings, setSettings] = React.useState<AppToolScopeSettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const sequence = React.useRef(0), pending = React.useRef(false);
  const appId = app.id || app.name;
  React.useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (pending.current) return;
      const version = ++sequence.current;
      try {
        const result = await api.getToolScope();
        if (active && version === sequence.current) { setSettings(result); setError(''); }
      } catch (cause) { if (active && version === sequence.current) setError(cleanIpcErrorMessage(cause)); }
    };
    void refresh();
    const off = api.onRuntime?.(() => { void refresh(); });
    return () => { active = false; ++sequence.current; off?.(); };
  }, [appId]);
  const change = async (scope: 'session' | 'global' | null) => {
    if (pending.current) return;
    pending.current = true; setSaving(true); setError('');
    const version = ++sequence.current;
    try {
      const result = await api.setToolScope({ scope });
      if (version === sequence.current) setSettings(result);
    } catch (cause) { if (version === sequence.current) setError(cleanIpcErrorMessage(cause)); }
    finally { pending.current = false; if (version === sequence.current) setSaving(false); }
  };
  const selected = settings?.overridden ? settings.scope : 'default';
  const defaultLabel = settings?.defaultScope === 'global' ? '全局' : '指定会话';
  return <section className="space-y-3" aria-label="工具使用范围">
    <div><h3 className="text-sm font-semibold">工具使用范围</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">对本 App 的全部工具生效，包括 MCP 工具。</p></div>
    <fieldset disabled={!settings || saving} className="grid gap-2 sm:grid-cols-3">
      <legend className="sr-only">工具使用范围</legend>
      {[
        { id: 'default', title: '跟随 App 默认', description: settings ? `当前默认：${defaultLabel}。随 App 默认设置更新。` : '正在读取 App 默认设置…' },
        { id: 'session', title: '指定会话', description: app.toolSelection === 'services' ? '在会话中选择此 App 的服务后使用。' : '在会话中选择此 App 后使用。' },
        { id: 'global', title: '全局', description: '所有会话均可按需使用；选中后工具常驻。' },
      ].map(option => <label key={option.id} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm has-disabled:cursor-wait has-disabled:opacity-60 ${settings && selected === option.id ? 'border-primary bg-primary/5' : 'border-border'}`}>
        <input type="radio" name={`tool-scope-${appId}`} value={option.id} checked={Boolean(settings && selected === option.id)} className="mt-0.5 accent-primary"
          onChange={() => void change(option.id === 'default' ? null : option.id as 'session' | 'global')} />
        <span><span className="block font-medium">{option.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span>
      </label>)}
    </fieldset>
    <p role="status" className="text-xs text-muted-foreground">{saving ? '正在保存…' : settings ? `当前生效：${settings.scope === 'global' ? '全局' : '指定会话'}。正在执行的会话下一轮生效。` : '正在读取设置…'}</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}
