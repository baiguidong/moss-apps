import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft } from 'lucide-react';
import { ToolScopeSettings } from './scope-settings';
import { AppMcpSettings } from './mcp-settings';
import { Button } from './primitives';
import { api } from './api';
import type { StoredApp } from './types';

declare const __APP_SETTINGS__: StoredApp;
const options = __APP_SETTINGS__;
const settingsRoute = '#/moss-settings';
let returnRoute = options.primaryRoute || '#/';

function SettingsPage() {
  const [app, setApp] = React.useState(options);
  React.useEffect(() => {
    let active = true;
    const refresh = () => { void api.installation().then(value => {
      const installation = value?.installation as { enabled?: boolean; grants?: string[] } | undefined;
      if (active && installation) setApp(previous => ({ ...previous, enabled: installation.enabled !== false, grants: installation.grants || [] }));
    }).catch(() => {}); };
    refresh();
    let off: (() => void) | undefined;
    try { off = api.onRuntime(refresh); } catch { /* The page still reports unavailable Host capabilities. */ }
    return () => { active = false; off?.(); };
  }, []);
  return <main className="mx-auto max-w-4xl space-y-6 p-5" aria-label="App 通用设置">
    <header className="flex items-center gap-3"><Button variant="ghost" size="icon" aria-label="返回应用" onClick={() => { location.hash = returnRoute; }}><ArrowLeft className="h-4 w-4" /></Button><h1 className="text-lg font-semibold">{options.title} 设置</h1></header>
    <ToolScopeSettings app={app} />
    {app.mcp && <AppMcpSettings app={app} />}
    {app.tools.length > 0 && <section className="space-y-3"><h2 className="text-sm font-semibold">可用工具</h2>{app.tools.map(tool => <div className="rounded-xl border border-border p-3" key={tool.id}><h3 className="text-sm font-medium">{tool.title || tool.id}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{tool.description}</p></div>)}</section>}
  </main>;
}

// A separate shadow root preserves the App's working page and isolates shared styles.
const container = document.createElement('div');
container.dataset.mossAppSettings = '';
const shadow = container.attachShadow({ mode: 'open' });
const style = document.createElement('link');
style.rel = 'stylesheet'; style.href = new URL('./app-settings.css', import.meta.url).href;
shadow.append(style);
const content = document.createElement('div'); shadow.append(content);
let root: ReturnType<typeof createRoot> | null = null;
let background: Array<{ element: HTMLElement; inert: boolean }> = [];
function navigate() {
  if (location.hash.split('?', 1)[0] === settingsRoute) {
    if (!root) {
      background = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && !['SCRIPT', 'LINK', 'STYLE'].includes(element.tagName)).map(element => ({ element, inert: element.inert }));
      background.forEach(({ element }) => { element.inert = true; });
      document.body.append(container); root = createRoot(content); root.render(<SettingsPage />);
    }
  } else {
    returnRoute = location.hash || options.primaryRoute;
    root?.unmount(); root = null; container.remove();
    background.forEach(({ element, inert }) => { element.inert = inert; }); background = [];
  }
}
window.addEventListener('hashchange', navigate);
navigate();
