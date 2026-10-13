import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadTestCatalog, selectTestCases, materializeTestCases, buildTestPrompt } from './catalog.mjs';
import { renderSelfTestReport } from './report.mjs';

const activePhases = new Set(['starting', 'running', 'stopping']);
const runIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const clone = value => structuredClone(value);
const errorText = error => error instanceof Error ? error.message : String(error);

function abortable(work, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function reportMarkdown(run) {
  const lines = [`# Moss AI 自测报告`, '', `运行：${run.id}`, `状态：${run.phase}`, `版本：${run.appVersion}`, `清单：${run.catalogRevision}`, '', run.message || '', ''];
  if (run.model) lines.push(`模型：${run.model}（主 Moss 配置，控制端与被测实例共用）`, `权限：${run.permissionMode}`, '');
  if (run.inheritedApps) lines.push(`继承 App：${run.inheritedApps.length} 个`, ...run.inheritedApps.map(app => `- ${app.id} ${app.version}（${app.enabled ? '启用' : '停用'}）`), '');
  for (const test of run.cases) {
    const result = run.results[test.id];
    lines.push(`## ${test.title} — ${result.status}`, '', result.notes || '');
    for (const check of result.checks || []) lines.push(`- ${check.passed ? '通过' : '失败'}：${test.expected[check.index]}\n  实际：${check.actual}`);
    for (const file of result.evidence || []) lines.push(`- 证据：${file}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function createSelfTestService({ directory, catalogDirectory, appVersion, instanceHome, isTarget = false, getSettings, prepareBrowser, launchInstance, createController, executeController, stopController, interruptController = stopController, notify = () => {}, openReportWindow = async () => {}, timeoutMs = 45 * 60_000, recordGraceMs = 1000 }) {
  let current = null, controller = null, pending = Promise.resolve(), starting = false, saveQueue = Promise.resolve();
  let onCaseRecorded = null;
  const getCatalog = () => loadTestCatalog(catalogDirectory);
  const snapshot = () => current ? clone(current) : { phase: 'idle', message: isTarget ? '当前窗口是被测实例。' : '', disabled: isTarget };
  async function persist() {
    const state = snapshot();
    const write = async () => {
      const temporary = path.join(state.directory, 'report.json.tmp');
      await fs.writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fs.rename(temporary, state.reportPath);
      await fs.writeFile(path.join(state.directory, 'report.md'), reportMarkdown(state));
      await writeHtmlReport(state);
      await fs.writeFile(path.join(directory, 'latest.json'), JSON.stringify({ id: state.id }));
      notify(state);
    };
    const operation = saveQueue.then(write);
    saveQueue = operation.catch(() => {});
    return operation;
  }

  async function writeHtmlReport(state) {
    const file = path.join(directory, state.id, 'report.html');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, await renderSelfTestReport(state), { mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
    return file;
  }

  async function openReport(id) {
    const state = await getStatus(id);
    if (!state.id) throw new Error('暂无自测报告。');
    // Regenerate the App report using the current Moss appearance.
    state.appearance = (await getSettings?.())?.appearance || state.appearance;
    const file = await writeHtmlReport(state);
    await openReportWindow(file);
    return { reportHtmlPath: file };
  }

  async function getStatus(id) {
    if (id && !runIdPattern.test(id)) throw new Error('自测运行 ID 无效。');
    if (current && (!id || id === current.id)) return snapshot();
    if (!id) {
      try { id = JSON.parse(await fs.readFile(path.join(directory, 'latest.json'), 'utf8')).id; }
      catch (error) { if (error.code === 'ENOENT') return snapshot(); throw error; }
    }
    if (!runIdPattern.test(id)) throw new Error('保存的自测运行 ID 无效。');
    const previous = JSON.parse(await fs.readFile(path.join(directory, id, 'report.json'), 'utf8'));
    return activePhases.has(previous.phase)
      ? { ...previous, phase: 'interrupted', message: 'Moss 已重启，此轮测试未完成。已保存的结果仍可查看。' }
      : previous;
  }

  async function run(settings, signal) {
    let instance, execution;
    const timer = setTimeout(() => controller?.abort(new Error('自测超过限定时间，已停止。')), timeoutMs);
    timer.unref?.();
    try {
      const browser = await abortable(prepareBrowser(), signal);
      signal.throwIfAborted();
      current.engineVersion = browser.version;
      instance = await launchInstance({ run: current, settings, signal, onProgress: async progress => {
        signal.throwIfAborted();
        current.preparation = { ...progress, updatedAt: Date.now() };
        current.message = progress.label;
        await persist();
      } });
      signal.throwIfAborted();
      current.endpoint = instance.endpoint;
      current.message = '测试窗口已就绪，正在创建 AI 控制会话…';
      current.preparation = { stage: 'controller', label: current.message, updatedAt: Date.now() };
      await persist();
      const sessionId = await createController(current, browser.config(instance.endpoint, current.evidenceDir));
      current.sessionId = sessionId;
      current.phase = 'running';
      current.message = '正在执行所选测试项。';
      await persist();
      signal.throwIfAborted();
      const stop = () => { void Promise.resolve(interruptController(sessionId)).catch(() => {}); };
      signal.addEventListener('abort', stop, { once: true });
      try {
        for (const [index, test] of current.cases.entries()) {
          signal.throwIfAborted();
          current.activeCaseId = test.id;
          current.message = `正在测试 ${index + 1}/${current.cases.length}：${test.title}`;
          await persist();
          let advanceTimer, interruptedAfterRecord = false;
          onCaseRecorded = () => {
            if (advanceTimer) return;
            // Give the result tool time to return before ending this controller turn.
            // The target and its data stay open; only the controller advances.
            advanceTimer = setTimeout(() => {
              interruptedAfterRecord = true;
              void Promise.resolve(interruptController(sessionId)).catch(() => {});
            }, recordGraceMs);
          };
          try {
            execution = executeController(sessionId, buildTestPrompt({ ...current, cases: [test] }), signal);
            await Promise.race([execution, instance.exited.then(() => { throw new Error('测试实例提前退出。'); })]);
          } catch (error) {
            signal.throwIfAborted();
            if (errorText(error) === '测试实例提前退出。') throw error;
            const recorded = current.results[test.id];
            if (recorded.status === 'pending') {
              current.results[test.id] = { status: 'blocked', checks: [], evidence: [],
                notes: `控制模型或工具执行未完成：${errorText(error)}。此项不能判断为通过，需检查控制会话。` };
            } else if (!interruptedAfterRecord) {
              // A later controller error must not discard already submitted observations.
              recorded.notes = `${recorded.notes || ''}\n结果提交后控制会话出错：${errorText(error)}。已保留实际检查和证据。`.trim();
            }
          } finally {
            clearTimeout(advanceTimer);
            onCaseRecorded = null;
          }
          if (current.results[test.id].status === 'pending') {
            current.results[test.id] = { status: 'blocked', checks: [], evidence: [], notes: 'AI 结束本项执行但未提交有效结果，需要复核控制会话。' };
          }
        }
        current.activeCaseId = null;
        signal.throwIfAborted();
        const allPassed = current.cases.every(test => current.results[test.id].status === 'passed');
        current.phase = allPassed ? 'completed' : 'failed';
        current.message = allPassed ? '所有所选测试项通过。' : '测试结束，存在失败、阻塞或未执行项目，请查看报告。';
      } finally {
        signal.removeEventListener('abort', stop);
      }
    } catch (error) {
      current.phase = signal.aborted && signal.reason?.message === '用户停止自测' ? 'canceled' : 'failed';
      current.message = errorText(signal.aborted ? signal.reason : error);
    } finally {
      clearTimeout(timer);
      current.activeCaseId = null;
      try {
        if (current.sessionId) {
          await interruptController(current.sessionId);
          // Let in-flight initialization/tool calls settle before disposing their MCP clients.
          await execution?.catch(() => {});
          await stopController(current.sessionId);
        }
      }
      catch (error) { current.phase = 'failed'; current.message += `\n测试会话清理失败：${errorText(error)}`; }
      if (instance?.isAlive?.() === true) current.message += ' 测试实例和数据已保留，可直接查看。';
      current.finishedAt = Date.now();
      await persist();
      try { await openReportWindow(current.reportHtmlPath); }
      catch (error) { current.reportOpenError = errorText(error); await persist(); }
      controller = null;
    }
  }

  async function start(ids) {
    if (isTarget) throw new Error('被测实例不能再次启动自测。请回到主 Moss。');
    if (starting || controller) throw new Error('已有自测正在运行，请等待完成或停止后重试。');
    starting = true;
    try {
      const settings = clone(await getSettings());
      if (!settings.model?.trim()) throw new Error('请先配置主 Moss 的文本模型，用于执行 AI 自测。');
      const catalog = await getCatalog();
      const selected = selectTestCases(catalog, ids);
      if (!selected.length) throw new Error('没有选中的测试项。');
      const id = randomUUID(), runDirectory = path.join(directory, id);
      const cases = materializeTestCases(selected, id);
      await fs.mkdir(path.join(runDirectory, 'evidence'), { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(runDirectory, 'catalog.json'), JSON.stringify(catalog, null, 2));
      const home = instanceHome || path.join(runDirectory, 'home');
      const fixturePath = path.join(home, 'self-test-workspace', 'self-test-note.txt');
      current = {
        id, phase: 'starting', message: '正在准备独立测试实例…', appVersion: settings.appVersion || appVersion, selfTestAppVersion: appVersion, appearance: settings.appearance || {}, catalogRevision: catalog.revision,
        model: settings.model, permissionMode: 'bypassPermissions',
        preparation: { stage: 'browser', label: '正在检查测试环境和当前模型配置…', updatedAt: Date.now() },
        directory: runDirectory, home, evidenceDir: path.join(runDirectory, 'evidence'),
        fixturePath, reportPath: path.join(runDirectory, 'report.json'), startedAt: Date.now(), finishedAt: null,
        reportHtmlPath: path.join(runDirectory, 'report.html'),
        sessionId: null, cases, results: Object.fromEntries(cases.map(test => [test.id, { status: 'pending', checks: [], evidence: [] }])),
      };
      await persist();
      controller = new AbortController();
      pending = run(settings, controller.signal).catch(error => {
        current.phase = 'failed'; current.message = errorText(error); controller = null; notify(snapshot());
      });
      return snapshot();
    } finally { starting = false; }
  }

  async function record(input, sessionId) {
    if (!current || current.phase !== 'running' || input.run_id !== current.id || sessionId !== current.sessionId) throw new Error('只有本轮测试会话可以提交结果。');
    const test = current.cases.find(test => test.id === input.case_id);
    if (!test || (current.activeCaseId && current.activeCaseId !== test.id) || !['passed', 'failed', 'blocked'].includes(input.status)) throw new Error('测试项目或结果状态无效，请只提交当前测试项。');
    const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
    const checks = input.checks || [], evidence = input.evidence || [];
    if (notes.length > 8000 || !Array.isArray(checks) || checks.length > test.expected.length || !Array.isArray(evidence) || evidence.length > 20) throw new Error('测试结果格式无效。');
    const seen = new Set();
    for (const check of checks) {
      if (!Number.isInteger(check.index) || !test.expected[check.index] || seen.has(check.index) || typeof check.passed !== 'boolean' || typeof check.actual !== 'string' || !check.actual.trim() || check.actual.length > 4000) throw new Error('请为每条通过标准提供有效的实际观察。');
      seen.add(check.index);
    }
    const resolvedEvidence = [];
    const evidenceRoot = await fs.realpath(current.evidenceDir);
    for (const file of evidence) {
      if (typeof file !== 'string' || !file.trim()) throw new Error('证据路径无效。');
      const fullPath = await fs.realpath(path.resolve(evidenceRoot, file));
      const relative = path.relative(evidenceRoot, fullPath);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !(await fs.stat(fullPath)).isFile()) throw new Error('证据必须是本轮 evidence 目录内的文件。');
      resolvedEvidence.push(relative);
    }
    if (input.status === 'passed' && (checks.length !== test.expected.length || checks.some(check => !check.passed) || !resolvedEvidence.some(file => /\.(png|jpe?g|webp)$/i.test(file)))) throw new Error('通过必须检查全部标准且提供实际截图。');
    if (input.status !== 'passed' && !notes) throw new Error('失败或阻塞必须说明原因。');
    // Disk reads above may yield while stop/completion changes the run state.
    if (current.phase !== 'running' || input.run_id !== current.id) throw new Error('本轮测试已结束。');
    current.results[test.id] = { status: input.status, checks: clone(checks), evidence: resolvedEvidence, notes, recordedAt: Date.now() };
    await persist();
    onCaseRecorded?.();
    return snapshot();
  }

  function stop(id) {
    if (id && id !== current?.id) throw new Error('不能停止其他历史测试。');
    if (controller) {
      current.phase = 'stopping'; current.message = '正在停止 AI 操作并保存结果，测试窗口和数据会保留…';
      controller.abort(new Error('用户停止自测'));
      notify(snapshot());
    }
    return snapshot();
  }

  return { start, stop, record, getStatus, getCatalog, openReport, waitForIdle: () => pending, snapshot,
    isRunning: () => starting || Boolean(controller),
    async handle(input, sessionId) {
      if (input.action === 'list') return getCatalog();
      if (input.action === 'status') return getStatus(input.run_id);
      if (input.action === 'start') {
        if (sessionId && sessionId === current?.sessionId) throw new Error('测试会话不能启动另一轮自测。');
        return start(input.case_ids);
      }
      if (input.action === 'record') return record(input, sessionId);
      if (input.action === 'stop') return stop(input.run_id);
      throw new Error('未知自测操作。');
    },
  };
}
