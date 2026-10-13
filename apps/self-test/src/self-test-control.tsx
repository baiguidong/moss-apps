import * as React from 'react';
import { Button } from './lib/button';
import { api } from './lib/api';
const cleanIpcErrorMessage = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : String(error);
import type { SelfTestCase, SelfTestStatus, SelfTestInstanceStatus } from './types';

const resultLabels = { pending: '未执行', passed: '通过', failed: '失败', blocked: '阻塞' };
const previewStep = (text: string) => text.replaceAll('{{runId}}', '本轮编号').replaceAll('{{runShortId}}', '本轮编号');

export function SelfTestControl() {
  const [cases, setCases] = React.useState<SelfTestCase[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState<SelfTestStatus>({ phase: 'idle', message: '' });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const [now, setNow] = React.useState(Date.now());
  const [instance, setInstance] = React.useState<SelfTestInstanceStatus | null>(null);
  const busy = ['starting', 'running', 'stopping'].includes(status.phase);
  const preparingInstance = instance?.phase === 'starting';
  React.useEffect(() => {
    if (!busy && !preparingInstance) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy, preparingInstance]);

  React.useEffect(() => {
    if (!api) return;
    let active = true, revision = 0, instanceRevision = 0;
    const off = api.onChanged(next => { revision++; if (active) setStatus(next); });
    const offInstance = api.onInstanceChanged(next => { instanceRevision++; if (active) setInstance(next); });
    void api.instanceStatus().then(next => { if (active && !instanceRevision) setInstance(next); }).catch(cause => { if (active) setError(cleanIpcErrorMessage(cause)); });
    void Promise.all([api.catalog(), api.status()]).then(([catalog, saved]) => {
      if (!active) return;
      setCases(catalog.cases);
      setSelected(catalog.cases.filter(test => test.default).map(test => test.id));
      if (!revision) setStatus(saved);
    }).catch(cause => { if (active) setError(cleanIpcErrorMessage(cause)); });
    return () => { active = false; off(); offInstance(); };
  }, []);

  const act = async (operation: () => Promise<unknown>) => {
    setPending(true); setError('');
    try { await operation(); }
    catch (cause) { setError(cleanIpcErrorMessage(cause)); }
    finally { setPending(false); }
  };

  return <div className="space-y-4 rounded-2xl border border-sidebar-border p-4">
    <p className="text-sm text-muted-foreground">AI 操作独立的 Moss 测试实例，复用已准备的环境。完成后保留窗口和测试数据，并自动打开包含实际观察、复现步骤和截图的 HTML 报告。</p>
    <div className="space-y-2 rounded-xl bg-muted/40 p-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending || instance?.phase === 'starting' || status.disabled}
          onClick={() => void act(async () => setInstance(await api.openInstance()))}>打开测试实例</Button>
        <Button size="sm" variant="outline" disabled={busy || pending || status.disabled || instance?.phase === 'starting'}
          onClick={() => void act(async () => setInstance(await api.syncInstance()))}>同步主 Moss 环境</Button>
        <Button size="sm" variant="outline" disabled={busy || pending || !instance?.prepared || status.disabled}
          onClick={() => void act(async () => setInstance(await api.clearData()))}>清理测试数据并重启</Button>
        {instance?.phase === 'open' && <Button size="sm" variant="ghost" disabled={busy || pending}
          onClick={() => void act(async () => setInstance(await api.closeInstance()))}>关闭测试窗口</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{instance?.message || '首次打开时准备环境，后续直接复用。'}</p>
      <p className="text-xs text-muted-foreground">清理会移除测试会话、团队、工作流等测试数据；已安装环境和历史报告会保留。</p>
      {preparingInstance && <div className="space-y-2" aria-live="polite">
        <progress className="h-2 w-full accent-emerald-600" aria-label="固定测试实例准备进度"
          value={instance.progress?.total ? instance.progress.current : undefined} max={instance.progress?.total || 1} />
        <p className="text-xs text-muted-foreground">已等待 {Math.max(0, Math.floor((now - (instance.startedAt || now)) / 1000))} 秒</p>
      </div>}
    </div>
    <div className="space-y-2">
      {cases.map(test => <div key={test.id} className="rounded-xl border border-sidebar-border px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.includes(test.id)} disabled={busy || pending || status.disabled}
            onChange={event => setSelected(previous => event.target.checked ? [...previous, test.id] : previous.filter(id => id !== test.id))} />
          <span>{test.title}</span>
          {test.requiresModel && <span className="text-xs text-muted-foreground">测试中调用模型</span>}
        </label>
        <details className="ml-5 mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">查看步骤与通过标准</summary>
          <p className="mt-2">前置条件：{test.prerequisites.join('；')}</p>
          <ol className="my-2 list-decimal space-y-1 pl-4">{test.steps.map((step, index) => <li key={index}>{previewStep(step)}</li>)}</ol>
          <p>通过标准：{test.expected.join('；')}</p>
        </details>
      </div>)}
    </div>
    <p className="text-xs text-muted-foreground">测试窗口继承当前 Moss 的设置、真实模型及已安装 App，权限完全放行。默认测试包括聊天、会话切换、真实工作流和 Agent Team 演示任务，测试记录和产物会保留。</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || preparingInstance || pending || !selected.length || status.disabled}
        onClick={() => void act(async () => setStatus(await api.start(selected)))}>开始自测</Button>
      {busy && <Button size="sm" variant="outline" disabled={pending || status.phase === 'stopping'}
        onClick={() => void act(async () => setStatus(await api.stop(status.id)))}>停止自测</Button>}
      {status.sessionId && <Button size="sm" variant="outline" onClick={() => void act(() => api.openSession(status.id))}>查看测试会话</Button>}
      {status.reportPath && <Button size="sm" variant="outline" onClick={() => void act(() => api.openReport(status.id))}>打开自测报告</Button>}
      {status.reportPath && <Button size="sm" variant="outline" onClick={() => void act(() => api.revealReport(status.id))}>查看报告文件</Button>}
    </div>
    <p className="text-sm text-muted-foreground" role="status">{status.message}</p>
    {status.phase === 'starting' && <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground" aria-live="polite">
      <p>{status.preparation?.label || '正在准备测试环境…'}</p>
      <progress className="h-2 w-full accent-emerald-600" aria-label="测试环境准备进度"
        value={status.preparation?.total ? status.preparation.current : undefined} max={status.preparation?.total || 1} />
      <p>已等待 {Math.max(0, Math.floor((now - (status.startedAt || now)) / 1000))} 秒 · 继承安装环境后会自动开始测试</p>
    </div>}
    {status.model && <p className="text-xs text-muted-foreground">本轮模型：{status.model} · 权限：完全放行</p>}
    {status.inheritedApps && <p className="text-xs text-muted-foreground">已继承 {status.inheritedApps.length} 个 App 的版本、启用状态、授权与配置</p>}
    {status.reportOpenError && <p className="text-xs text-destructive">报告已保存，自动打开失败：{status.reportOpenError}。可点击“打开自测报告”重试。</p>}
    {status.cases && <ul className="space-y-1 text-xs">{status.cases.map(test => <li key={test.id}>
      {test.title}：{resultLabels[status.results?.[test.id]?.status || 'pending']}
      {status.results?.[test.id]?.notes && <span className="ml-2 text-muted-foreground">{status.results[test.id].notes}</span>}
    </li>)}</ul>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
