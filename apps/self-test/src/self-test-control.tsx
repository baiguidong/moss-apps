import * as React from 'react';
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, Circle, CircleAlert, Clock3, FileText, Layers3, Loader2, Monitor, Play, RefreshCw, Square, Trash2, XCircle } from 'lucide-react';
import { Button } from './lib/button';
import { api } from './lib/api';
import type { SelfTestCase, SelfTestStatus, SelfTestInstanceStatus } from './types';

const cleanError = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : String(error);
const resultLabels = { pending: '未执行', passed: '通过', failed: '失败', blocked: '阻塞' };
const phaseLabels = { idle: '准备开始', starting: '准备测试环境', running: '正在检查', stopping: '正在停止', completed: '检查全部通过', failed: '检查结束，存在问题', canceled: '本轮已停止', interrupted: '本轮已中断' };
const previewStep = (text: string) => text.replaceAll('{{runId}}', '本轮编号').replaceAll('{{runShortId}}', '本轮编号');
const elapsed = (start?: number, end?: number) => {
  if (!start || !end) return '—';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
};

export function SelfTestControl() {
  const [cases, setCases] = React.useState<SelfTestCase[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [resetData, setResetData] = React.useState(true);
  const [query, setQuery] = React.useState('');
  const [group, setGroup] = React.useState('全部模块');
  const [status, setStatus] = React.useState<SelfTestStatus>({ phase: 'idle', message: '' });
  const [pending, setPending] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState('');
  const [now, setNow] = React.useState(Date.now());
  const [instance, setInstance] = React.useState<SelfTestInstanceStatus | null>(null);
  const busy = ['starting', 'running', 'stopping'].includes(status.phase);
  const preparingInstance = instance?.phase === 'starting';
  const unavailable = status.disabled || instance?.disabled;
  React.useEffect(() => {
    if (!busy && !preparingInstance) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy, preparingInstance]);

  React.useEffect(() => {
    let active = true, revision = 0, instanceRevision = 0;
    const off = api.onChanged(next => { revision++; if (active) setStatus(next); });
    const offInstance = api.onInstanceChanged(next => { instanceRevision++; if (active) setInstance(next); });
    void api.instanceStatus().then(next => { if (active && !instanceRevision) setInstance(next); }).catch(cause => { if (active) setError(cleanError(cause)); });
    void Promise.all([api.catalog(), api.status()]).then(([catalog, saved]) => {
      if (!active) return;
      setCases(catalog.cases);
      setSelected(catalog.cases.filter(test => test.default).map(test => test.id));
      if (!revision) setStatus(saved);
    }).catch(cause => { if (active) setError(cleanError(cause)); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; off(); offInstance(); };
  }, []);

  const act = async (operation: () => Promise<unknown>) => {
    setPending(true); setError('');
    try { await operation(); }
    catch (cause) { setError(cleanError(cause)); }
    finally { setPending(false); }
  };
  const results = Object.values(status.results || {});
  const checked = results.filter(result => result.status !== 'pending').length;
  const passed = results.filter(result => result.status === 'passed').length;
  const issues = results.filter(result => ['failed', 'blocked'].includes(result.status)).length;
  const total = status.cases?.length || 0;
  const activeCase = status.cases?.find(test => test.id === (status.executionCaseId || status.activeCaseId));
  const pageChecked = results.filter(result => result.executionFinishedAt).length;
  const reviewed = results.filter(result => result.recordedAt).length;
  const reviewingTitles = status.cases?.filter(test => status.activeCaseIds?.includes(test.id)).map(test => test.title).join('、');
  const selectedModelCount = cases.filter(test => selected.includes(test.id) && test.requiresModel).length;
  const groups = [...new Set(cases.map(test => test.group || '其他'))];
  const visibleCases = cases.filter(test => (group === '全部模块' || (test.group || '其他') === group)
    && [test.title, test.id, test.group, ...test.steps].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const presets = [
    { label: '默认项目', ids: cases.filter(test => test.default).map(test => test.id) },
    { label: '界面检查', ids: cases.filter(test => !test.requiresModel).map(test => test.id) },
    { label: '全部项目', ids: cases.map(test => test.id) },
    ...(issues ? [{ label: '重测问题项', ids: cases.filter(test => ['failed', 'blocked'].includes(status.results?.[test.id]?.status || '')).map(test => test.id) }] : []),
  ];

  return <div className="self-test" aria-label="AI 自测">

    {error && <div role="alert" className="notice is-error"><CircleAlert size={17} /><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
    {unavailable && <div className="notice"><Monitor size={17} /><span>当前窗口是被测实例，请回到主 Moss 启动自测。</span></div>}

    <section className={`run-overview ${busy ? 'is-running' : ''}`} aria-label="运行概览">
      <div className="run-topline"><div className="run-state" role="status">
        {busy ? <Loader2 size={18} className="spin" /> : status.phase === 'completed' ? <CheckCircle2 size={18} /> : ['failed', 'interrupted'].includes(status.phase) ? <CircleAlert size={18} /> : <span className="state-dot" />}
        <strong>{phaseLabels[status.phase]}</strong><span className="run-label">{status.id ? `本轮 ${status.id.slice(0, 8)}` : '独立测试环境'}</span>
      </div><div className="run-actions"><span className="run-time"><Clock3 size={14} />{status.startedAt ? elapsed(status.startedAt, status.finishedAt || now) : '尚未运行'}</span>{busy ? <Button variant="outline" className="stop-button" disabled={pending || status.phase === 'stopping'} onClick={() => void act(async () => setStatus(await api.stop(status.id)))}><Square size={14} />{status.phase === 'stopping' ? '正在停止…' : '停止自测'}</Button>
        : <Button className="start-button" disabled={!loaded || preparingInstance || pending || !selected.length || unavailable} onClick={() => void act(async () => setStatus(await api.start(selected, resetData)))}><Play size={15} />开始自测</Button>}</div></div>
      <p className="run-description">{status.controllerSessions ? status.message : activeCase ? `当前项目 · ${activeCase.title}` : status.message || '选择要检查的项目，AI 会操作独立窗口并保存截图与报告。'}</p>
      {status.executionMode && <div className="pipeline-progress" aria-label="执行与验收进度"><span>页面检查 <b>{pageChecked}/{total}</b></span><span>AI 已验收 <b>{reviewed}/{total}</b></span><span>待补查 <b>{status.diagnosisCaseIds?.length || 0}</b></span>{busy && reviewingTitles && <small>正在验收：{reviewingTitles}</small>}</div>}
      {busy && <div className="active-test" aria-label="当前测试详情">
        {activeCase ? <>
          <div className="active-test-heading"><span>第 {(status.cases?.findIndex(test => test.id === activeCase.id) ?? 0) + 1} / {total} 项</span><strong>{activeCase.title}</strong><time>{elapsed(status.results?.[activeCase.id]?.startedAt, now)}</time></div>
          <p>本项检查内容</p><ol>{activeCase.steps.map((step, index) => <li key={index}>{previewStep(step)}</li>)}</ol>
          <span className="active-test-note">正在执行并核对页面结果，完成后更新检查记录。</span>
        </> : <><strong>{status.phase === 'running' ? reviewingTitles ? `AI 正在验收：${reviewingTitles}` : status.message : status.preparation?.label || status.message || '正在准备新一轮测试…'}</strong><p>清理数据 → 打开测试窗口 → 创建新测试会话 → 执行项目</p></>}
      </div>}
      {status.startedAt && (status.environmentReadyAt || (busy && status.phase === 'starting')) && <div className="phase-times" aria-label="分阶段耗时">
        <span>测试与复核（不含准备）<b>{elapsed(status.environmentReadyAt, status.finishedAt || now)}</b></span>
        <span>环境准备 <b>{elapsed(status.startedAt, status.environmentReadyAt || status.finishedAt || now)}</b></span>
        {status.controllerSessions ? <>
          <span>页面操作 <b>{Math.round(results.reduce((sum, result) => sum + (result.executionMs || 0), 0) / 1000)} 秒</b></span>
          <span>AI 核对与补查 <b>{Math.round(status.controllerSessions.reduce((sum, session) => sum + ((session.finishedAt || status.finishedAt || now) - session.startedAt), 0) / 1000)} 秒</b></span>
        </> : <><span>会话准备 <b>{elapsed(status.environmentReadyAt, status.controllerReadyAt || status.finishedAt || now)}</b></span>
        <span>测试执行 <b>{elapsed(status.controllerReadyAt, status.finishedAt || now)}</b></span></>}
      </div>}
      {busy && <progress className="run-progress" aria-label="自测完成进度" value={status.phase === 'starting' ? undefined : checked} max={total || 1} />}
      <div className="run-metrics">
        <div><span>已结算</span><strong>{status.id ? checked : '—'}<small> / {status.id ? total : selected.length}</small></strong></div>
        <div><span><i className="metric-dot is-passed" />通过</span><strong>{status.id ? passed : '—'}</strong></div>
        <div><span><i className="metric-dot is-failed" />失败 / 阻塞</span><strong className={issues ? 'has-issues' : ''}>{status.id ? issues : '—'}</strong></div>
      </div>
      {status.id && <footer className="run-footer"><span className="run-model" title={status.model}>{status.model || '当前 Moss 模型'}{status.inheritedApps ? ` · ${status.inheritedApps.length} 个 App` : ''}</span><div className="run-links">
        {status.sessionId && <Button variant="ghost" disabled={pending} onClick={() => void act(() => api.openSession(status.id))}>测试会话<ArrowUpRight size={13} /></Button>}
        {status.reportPath && <Button variant="ghost" disabled={pending} onClick={() => void act(() => api.openReport(status.id))}><FileText size={13} />查看报告</Button>}
      </div></footer>}
      {status.reportOpenError && <p className="report-error">报告已保存，自动打开失败：{status.reportOpenError}。可点击“查看报告”重试。</p>}
    </section>

    <section className="environment" aria-label="测试环境">
      <div className="environment-main"><Monitor size={18} /><div><strong>测试环境</strong><span className={`environment-state ${instance?.phase === 'open' ? 'is-open' : ''}`}><i />{preparingInstance ? '准备中' : instance?.phase === 'open' ? '窗口已打开' : instance?.prepared ? '已就绪 · 窗口已关闭' : '首次运行时准备'}</span></div>
        <Button size="sm" variant="outline" disabled={pending || preparingInstance || unavailable} onClick={() => void act(async () => setInstance(await api.openInstance()))}><ArrowUpRight size={14} />打开测试实例</Button>
      </div>
      <label className="reset-option"><input type="checkbox" checked={resetData} disabled={busy || pending || unavailable} onChange={event => setResetData(event.target.checked)} /><span>开始前自动清理上轮测试数据<small>每轮核对主环境变化，复用工具链缓存并保留历史报告。</small></span></label>
      {preparingInstance && <div className="environment-progress" aria-live="polite"><p>{instance.message}</p><progress aria-label="测试环境准备进度" value={instance.progress?.total ? instance.progress.current : undefined} max={instance.progress?.total || 1} /><span>已等待 {elapsed(instance.startedAt, now)}</span></div>}
      <details className="environment-details"><summary>环境管理<ChevronDown size={14} /></summary><div className="environment-options"><p>{instance?.message || '开始时核对主 Moss 的模型、App 与配置，自动同步变化并复用缓存。'}</p><div className="environment-actions">
        <Button variant="outline" disabled={busy || pending || preparingInstance || unavailable} onClick={() => void act(async () => setInstance(await api.syncInstance()))}><RefreshCw size={13} />同步主 Moss 环境</Button>
        <Button variant="outline" disabled={busy || pending || preparingInstance || !instance?.prepared || unavailable} onClick={() => void act(async () => setInstance(await api.clearData()))}><Trash2 size={13} />清理测试数据并重启</Button>
        {instance?.phase === 'open' && <Button variant="ghost" disabled={busy || pending} onClick={() => void act(async () => setInstance(await api.closeInstance()))}>关闭测试窗口</Button>}
        {status.reportPath && <Button variant="ghost" disabled={pending} onClick={() => void act(() => api.revealReport(status.id))}>查看报告文件<ArrowUpRight size={13} /></Button>}
      </div><p>清理会移除测试会话、团队和工作流；已安装环境与历史报告会保留。</p></div></details>
    </section>

    <section className="case-section" aria-label="测试项目">
      <div className="section-heading"><div><h2>测试项目</h2><span>{busy ? `本轮 ${total} 项` : `已选 ${selected.length} / ${cases.length} 项`}</span></div><span className="section-hint">{status.id ? '展开查看步骤与本轮结果' : '展开查看步骤与通过标准'}</span></div>
      <div className="case-presets" aria-label="快速选择测试项目">{presets.map(preset => {
        const active = preset.ids.length > 0 && preset.ids.length === selected.length && preset.ids.every(id => selected.includes(id));
        return <button type="button" key={preset.label} aria-pressed={active} disabled={!loaded || busy || pending || unavailable} onClick={() => setSelected(preset.ids)}>{active && <Check size={13} />}{preset.label}<span>{preset.ids.length}</span></button>;
      })}</div>
      <div className="case-filters">
        <input type="search" aria-label="搜索测试项目" placeholder="搜索功能、项目或步骤…" value={query} onChange={event => setQuery(event.target.value)} />
        <select aria-label="测试模块" value={group} onChange={event => setGroup(event.target.value)}><option>全部模块</option>{groups.map(name => <option key={name}>{name}</option>)}</select>
        <span>{visibleCases.length} 项 · {groups.length} 个模块</span>
      </div>
      <div className="case-list">{!loaded && <div className="loading-cases"><Loader2 size={16} className="spin" />正在加载测试项目…</div>}{loaded && !cases.length && <p className="empty-cases">测试清单暂不可用，请重新打开 App。</p>}
        {loaded && cases.length > 0 && !visibleCases.length && <p className="empty-cases">没有匹配项目，请调整搜索或模块。</p>}
        {visibleCases.map((test, visibleIndex) => {
          const index = cases.findIndex(item => item.id === test.id);
          const groupName = test.group || '其他';
          const groupIds = cases.filter(item => (item.group || '其他') === groupName).map(item => item.id);
          const groupSelected = groupIds.every(id => selected.includes(id));
          const result = status.results?.[test.id];
          const running = busy && (status.activeCaseIds?.includes(test.id) || status.activeCaseId === test.id);
          const stopped = !busy && result?.status === 'pending' && Boolean(result.startedAt);
          const label = running ? result?.stage === 'review' ? 'AI 核对中' : result?.stage === 'diagnosis' ? '补查中' : '检查中' : result?.status === 'pending' && result.stage === 'review-queued' && busy ? '待 AI 核对' : result?.stage === 'diagnosis-queued' && busy ? '待补查' : stopped ? '已停止' : result?.reasonCode?.startsWith('review') || result?.reasonCode?.endsWith('timeout') || result?.reasonCode === 'diagnosis-budget' ? '验收未完成' : result ? resultLabels[result.status] : '';
          const ResultIcon = running ? Loader2 : result?.status === 'passed' ? CheckCircle2 : result?.status === 'failed' ? XCircle : result?.status === 'blocked' ? CircleAlert : Circle;
          return <React.Fragment key={test.id}>
            {(visibleIndex === 0 || visibleCases[visibleIndex - 1].group !== test.group) && <div className="case-group"><h3>{groupName}<span>{groupIds.filter(id => selected.includes(id)).length} / {groupIds.length}</span></h3><button type="button" aria-label={`${groupSelected ? '取消' : '选择'}${groupName}全部项目`} disabled={busy || pending || unavailable} onClick={() => setSelected(previous => groupSelected ? previous.filter(id => !groupIds.includes(id)) : [...new Set([...previous, ...groupIds])])}>{groupSelected ? '取消本组' : '选择本组'}</button></div>}
            <div className={`case-item ${running ? 'is-active' : ''} ${selected.includes(test.id) ? 'is-selected' : ''}`} data-case-id={test.id}>
            <div className="case-row"><label className="case-select"><input type="checkbox" aria-label={test.title} checked={selected.includes(test.id)} disabled={busy || pending || unavailable} onChange={event => setSelected(previous => event.target.checked ? [...previous, test.id] : previous.filter(id => id !== test.id))} /><span className="case-index">{String(index + 1).padStart(2, '0')}</span><span className="case-title">{test.title}</span></label>
              <span className="case-kind">{['workflow-demo', 'agent-team-demo'].includes(test.id) ? '协作演示' : test.requiresModel ? '模型交互' : '界面'}</span>
              {label && <span className={`case-result is-${running ? 'running' : result?.status}`}><ResultIcon size={14} className={running ? 'spin' : ''} />{label}</span>}
              {result?.startedAt && <span className="case-duration">{elapsed(result.startedAt, result.finishedAt || result.recordedAt || status.finishedAt || now)}</span>}
            </div>
            <details className="case-details"><summary>{result && result.status !== 'pending' ? '步骤与检查结果' : '步骤与通过标准'}<ChevronDown size={13} /></summary><div className="case-detail-content">
              <p className="case-prerequisite">{test.prerequisites.join('；')}</p>
              <div className="case-detail-columns"><div><h3>操作步骤</h3><ol>{test.steps.map((step, i) => <li key={i}>{previewStep(step)}</li>)}</ol></div><div><h3>通过标准</h3><ul>{test.expected.map((expected, i) => <li key={i}>{previewStep(expected)}</li>)}</ul></div></div>
              {result && (result.notes || result.checks?.length || result.evidence?.length) ? <div className={`case-observation is-${result.status}`}><h3>实际观察</h3>{result.notes && <p>{result.notes}</p>}{result.checks?.map(check => <p key={check.index}><strong>{result.status === 'pending' ? '页面观察' : check.passed ? '通过' : '未通过'} · </strong>{check.actual}</p>)}{Boolean(result.evidence?.length) && <span><FileText size={12} />已保存 {result.evidence!.length} 份证据，可在报告中查看</span>}</div> : null}
            </div></details>
          </div></React.Fragment>;
        })}
      </div>
      <p className="selection-note"><Layers3 size={14} /><span>{selectedModelCount ? `已选 ${selectedModelCount} 项会在被测窗口中调用真实模型，聊天与协作任务需要等待回复。` : '当前选择检查界面操作；测试控制 AI 仍使用主 Moss 的模型。'}完成后保留测试窗口、数据与报告。</span></p>
    </section>
  </div>;
}
