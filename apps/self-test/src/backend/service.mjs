import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createReviewQueue } from './review-queue.mjs';
import { loadTestCatalog, selectTestCases, materializeTestCases, buildTestPrompt } from './catalog.mjs';
import { renderSelfTestReport } from './report.mjs';
import { prepareUiRecipes } from './ui-recipes.mjs';
import { buildReviewPrompt, REVIEW_BATCH_SIZE } from './review-prompt.mjs';

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

export function suiteTimeoutMs(cases) {
  return Math.max(45 * 60_000, 300_000 + cases.reduce((sum, test) => sum + (test.timeoutSeconds || 180) * 1000, 0));
}

export function createSelfTestService({ directory, catalogDirectory, appVersion, instanceHome, isTarget = false, getSettings, prepareBrowser, launchInstance, createController, executeController, executeRecipe, stopController, interruptController = stopController, notify = () => {}, openReportWindow = async () => {}, timeoutMs, reviewTimeoutMs = 45_000, diagnosticTimeoutMs = 60_000, diagnosticBudgetMs = 120_000, finishController = interruptController, batchWaitMs = 100 }) {
  let current = null, controller = null, pending = Promise.resolve(), starting = false, saveQueue = Promise.resolve();
  const assignments = new Map();
  const getCatalog = () => loadTestCatalog(catalogDirectory);
  const snapshot = () => current ? clone(current) : { phase: 'idle', message: isTarget ? '当前窗口是被测实例。' : '', disabled: isTarget };
  async function persist() {
    const state = snapshot();
    const write = async () => {
      const temporary = path.join(state.directory, 'report.json.tmp');
      await fs.writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fs.rename(temporary, state.reportPath);
      await fs.writeFile(path.join(state.directory, 'report.md'), reportMarkdown(state));
      if (state.finishedAt) await writeHtmlReport(state);
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

  async function run(settings, parentSignal) {
    const lifetime = new AbortController();
    const signal = AbortSignal.any([parentSignal, lifetime.signal]);
    const budgets = new Map(), diagnoses = new Map();
    let instance, reviewQueue;
    const timer = setTimeout(() => lifetime.abort(new Error('自测超过限定时间，已停止。')), timeoutMs ?? suiteTimeoutMs(current.cases));
    const stop = () => { for (const [id] of assignments) void Promise.resolve(interruptController(id)).catch(() => {}); };
    signal.addEventListener('abort', stop, { once: true });
    const scheduleDiagnosis = test => {
      diagnoses.set(test.id, test);
      current.results[test.id].stage = 'diagnosis-queued';
      current.diagnosisCaseIds = [...diagnoses.keys()];
    };
    const settleUnreviewed = (test, notes, reasonCode = 'review-incomplete') => {
      const result = current.results[test.id];
      if (result.status !== 'pending') return;
      Object.assign(result, { status: 'blocked', reasonCode, notes, stage: 'complete', finishedAt: Date.now() });
    };
    const review = async (requested, { diagnostic = false, dynamic = false, remainingMs = Infinity } = {}) => {
      signal.throwIfAborted();
      const tests = requested.filter(test => current.results[test.id].status === 'pending');
      if (!tests.length) return;
      const budget = Math.min(remainingMs, diagnostic ? diagnosticTimeoutMs : dynamic
        ? Math.max(...tests.map(test => (test.timeoutSeconds || 180) * 1000))
        : reviewTimeoutMs, ...(!diagnostic && !dynamic ? tests.map(test => (budgets.get(test.id) ?? Infinity) - performance.now()) : []));
      if (budget <= 0) {
        for (const test of tests) settleUnreviewed(test, '本项执行与验收总时限已用尽，保留页面事实与截图。', 'case-timeout');
        await persist(); return;
      }
      const evidenceReview = !diagnostic && !dynamic && tests.every(test => current.results[test.id].observation?.evidence?.some(file => /\.(png|jpe?g|webp)$/i.test(file)));
      const jobId = randomUUID(), deadlineAt = performance.now() + budget;
      const entry = { jobId, sessionId: null, caseIds: tests.map(test => test.id), evidenceReview,
        stage: diagnostic ? 'diagnosis' : dynamic ? 'dynamic' : 'review', startedAt: Date.now(), promptChars: [], budgetMs: Math.round(budget) };
      let sessionId, execution;
      const turnAbort = new AbortController(), turnSignal = AbortSignal.any([signal, turnAbort.signal]);
      const deadline = setTimeout(() => {
        entry.timedOut = true;
        turnAbort.abort(new Error('AI 核对超过本项时间上限。'));
        if (sessionId) void Promise.resolve(interruptController(sessionId)).catch(() => {});
      }, budget);
      current.controllerSessions.push(entry);
      try {
        sessionId = await createController(current, { ...current.browserConfig, evidenceReview });
        signal.throwIfAborted();
        entry.sessionId = sessionId; current.sessionId = sessionId;
        current.controllerReadyAt ||= Date.now(); current.activeCaseIds = [...entry.caseIds];
        if (!evidenceReview) current.activeCaseId = tests[0].id;
        for (const test of tests) Object.assign(current.results[test.id], {
          stage: entry.stage, reviewStartedAt: Date.now(), controllerSessionId: sessionId,
          reviewWaitMs: Date.now() - (current.results[test.id].executionFinishedAt || entry.startedAt),
        });
        const unresolved = test => current.results[test.id].status === 'pending'
          && !(evidenceReview && current.results[test.id].inspection?.sessionId === sessionId);
        const assignment = { entry, runId: current.id, accepting: true, finishing: null,
          recorded: async () => {
            if (tests.some(unresolved)) return;
            assignment.finishing ||= Promise.resolve(finishController(sessionId));
            await assignment.finishing;
          } };
        assignments.set(sessionId, assignment);
        current.message = evidenceReview ? '页面检查与 AI 验收正在并行进行。' : `${diagnostic ? '补查' : '执行'}：${tests.map(test => test.title).join('、')}`;
        await persist();
        for (let attempt = 0; attempt < 2; attempt++) {
          const missing = tests.filter(unresolved);
          if (!missing.length) break;
          turnSignal.throwIfAborted();
          if (performance.now() >= deadlineAt) throw new Error('AI 核对超过本项时间上限。');
          const prompt = executeRecipe ? buildReviewPrompt(current, missing, { retry: attempt > 0, evidenceReview })
            : buildTestPrompt({ ...current, cases: missing, caseIndex: 0 });
          entry.promptChars.push(prompt.length);
          const evidence = [...new Set(missing.flatMap(test => current.results[test.id].observation?.evidence || []))]
            .filter(file => /\.(png|jpe?g|webp)$/i.test(file));
          execution = executeController(sessionId, prompt, turnSignal, { evidence: evidence.length ? evidence : undefined });
          await Promise.race([abortable(execution, turnSignal), instance.exited.then(() => { throw new Error('测试实例提前退出。'); })]);
          signal.throwIfAborted();
        }
      } catch (error) {
        entry.error = errorText(turnSignal.aborted ? turnSignal.reason : error);
        signal.throwIfAborted();
        if (errorText(error) === '测试实例提前退出。') throw error;
      } finally {
        clearTimeout(deadline);
        const assignment = assignments.get(sessionId);
        if (assignment) assignment.accepting = false;
        if (sessionId) {
          if (turnSignal.aborted || entry.error) await interruptController(sessionId);
          await execution?.catch(() => {});
          await stopController(sessionId);
          assignments.delete(sessionId);
        }
        entry.finishedAt = Date.now(); current.activeCaseIds = [];
        if (!evidenceReview) current.activeCaseId = null;
      }
      for (const test of tests) {
        const result = current.results[test.id];
        if (evidenceReview && result.status === 'pending' && result.inspection?.sessionId === sessionId) scheduleDiagnosis(test);
        else {
          settleUnreviewed(test, entry.error ? `AI 验收未完成：${entry.error} 已保留页面观察和截图。`
            : 'AI 未提交有效结果，补交一次后仍未完成。已保留页面观察和截图，不能计为通过。');
          result.finishedAt ||= entry.finishedAt;
        }
      }
      await persist();
    };
    try {
      const browser = await abortable(prepareBrowser(), signal);
      current.engineVersion = browser.version; current.selfTestPackageHash = browser.packageHash;
      instance = await launchInstance({ run: current, settings, signal, onProgress: async progress => {
        signal.throwIfAborted(); current.preparation = { ...progress, updatedAt: Date.now() }; current.message = progress.label; await persist();
      } });
      signal.throwIfAborted();
      current.endpoint = instance.endpoint; current.environmentReadyAt = Date.now();
      current.scripts = await prepareUiRecipes(current);
      current.browserConfig = browser.config(instance.endpoint, current.evidenceDir);
      current.controllerSessions = []; current.diagnosisCaseIds = [];
      current.phase = 'running'; current.message = '正在执行页面检查。';
      await persist();
      reviewQueue = createReviewQueue({ signal, review, batchWaitMs,
        weight: test => current.results[test.id].evidenceSize || { images: 0, bytes: 0 },
        onError: error => lifetime.abort(error),
      });
      const dynamicTests = [];
      for (const test of current.cases) {
        signal.throwIfAborted();
        if (!executeRecipe || !current.scripts[test.id]) { dynamicTests.push(test); continue; }
        await reviewQueue.ready();
        // A target-model request has priority over new control-model requests.
        if (test.requiresModel) await reviewQueue.drain();
        current.executionCaseId = test.id; current.activeCaseId = test.id;
        const result = current.results[test.id], started = performance.now();
        const allowance = (test.requiresModel ? test.timeoutSeconds || 180 : Math.min(test.timeoutSeconds || 90, 90)) * 1000;
        budgets.set(test.id, started + allowance);
        Object.assign(result, { startedAt: Date.now(), stage: 'execution', budgetMs: allowance });
        await persist();
        let observation;
        try { observation = await executeRecipe(current, { ...test, timeoutSeconds: allowance / 1000 }, signal); }
        catch (error) { signal.throwIfAborted(); observation = { error: errorText(error), checks: [], evidence: [] }; }
        signal.throwIfAborted();
        try {
          const value = await validatedResult({ ...observation, status: observation.error ? 'blocked' : 'passed', notes: observation.error || '' }, test);
          observation = { ...observation, checks: value.checks, evidence: value.evidence };
        } catch (error) {
          // Validate each retained artifact separately; rejected paths must never
          // reach file stats, native image attachments or observation bundles.
          const evidence = [];
          for (const file of observation.evidence || []) {
            try { evidence.push(...(await validatedResult({ status: 'blocked', notes: '证据校验', checks: [], evidence: [file] }, test)).evidence); } catch {}
          }
          observation = { error: `页面检查证据不完整：${errorText(error)}`, checks: [], evidence };
        }
        const evidenceSize = { images: 0, bytes: 0, pixels: 0 }, evidenceManifest = [];
        for (const file of observation.evidence || []) {
          if (!/\.(png|jpe?g|webp)$/i.test(file)) continue;
          try {
            const bytes = await fs.readFile(path.resolve(current.evidenceDir, file));
            const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
            const width = png ? bytes.readUInt32BE(16) : null, height = png ? bytes.readUInt32BE(20) : null;
            evidenceSize.bytes += bytes.length; evidenceSize.images++; evidenceSize.pixels += png ? width * height : 4_500_000;
            evidenceManifest.push({ file, width, height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
          } catch {}
        }
        const bundleId = createHash('sha256').update(JSON.stringify({ caseId: test.id, observation, evidenceManifest })).digest('hex');
        Object.assign(result, { checks: observation.checks || [], evidence: observation.evidence || [], observation,
          evidenceBundleId: bundleId, evidenceSize, evidenceManifest, executionMs: Math.round(performance.now() - started), executionFinishedAt: Date.now(), stage: 'review-queued' });
        await fs.writeFile(path.join(current.evidenceDir, `${test.id}-observation.json`), JSON.stringify({ bundleId, observation, evidenceManifest }, null, 2));
        current.executionCaseId = null; current.activeCaseId = null;
        await persist();
        if (evidenceSize.images) await reviewQueue.push(test);
        else { scheduleDiagnosis(test); await persist(); }
      }
      await reviewQueue.close();
      // Dynamic scenarios remain selected work, but cannot hold up independent fixed checks.
      for (const test of dynamicTests) {
        current.results[test.id].startedAt = Date.now();
        await review([test], { dynamic: true });
      }
      if (diagnoses.size) {
        current.diagnosisStartedAt = Date.now();
        const until = performance.now() + diagnosticBudgetMs;
        for (const test of diagnoses.values()) {
          signal.throwIfAborted();
          const remaining = until - performance.now();
          if (remaining <= 0) settleUnreviewed(test, '本轮补查时间预算已用尽，证据保留，验收未完成。', 'diagnosis-budget');
          else await review([test], { diagnostic: true, remainingMs: remaining });
          current.diagnosisCaseIds = current.diagnosisCaseIds.filter(id => id !== test.id);
        }
        current.diagnosisFinishedAt = Date.now();
      }
      signal.throwIfAborted();
      const allPassed = current.cases.every(test => current.results[test.id].status === 'passed');
      current.phase = allPassed ? 'completed' : 'failed';
      current.message = allPassed ? '所有所选测试项通过。' : '测试结束，存在失败、阻塞或未完成验收，请查看报告。';
    } catch (error) {
      lifetime.abort(error);
      current.phase = parentSignal.aborted && parentSignal.reason?.message === '用户停止自测' ? 'canceled' : 'failed';
      current.message = errorText(signal.aborted ? signal.reason : error);
    } finally {
      if (signal.aborted) await reviewQueue?.close().catch(() => {});
      clearTimeout(timer); signal.removeEventListener('abort', stop);
      current.activeCaseId = null; current.executionCaseId = null; current.activeCaseIds = [];
      delete current.browserConfig;
      if (instance?.isAlive?.() === true) current.message += ' 测试实例和数据已保留，可直接查看。';
      current.finishedAt = Date.now();
      await persist();
      try { await openReportWindow(current.reportHtmlPath); }
      catch (error) { current.reportOpenError = errorText(error); await persist(); }
      controller = null;
    }
  }

  async function start(ids, { resetData = true } = {}) {
    if (isTarget) throw new Error('被测实例不能再次启动自测。请回到主 Moss。');
    if (starting || controller) throw new Error('已有自测正在运行，请等待完成或停止后重试。');
    starting = true;
    try {
      if (typeof resetData !== 'boolean') throw new Error('清理测试数据选项无效。');
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
        id, phase: 'starting', message: '正在准备独立测试实例…', appVersion: settings.appVersion || appVersion, selfTestAppVersion: appVersion, appearance: settings.appearance || {}, catalogRevision: catalog.revision, hostBuildId: settings.hostBuildId, executionMode: 'pipeline',
        model: settings.model, permissionMode: 'bypassPermissions',
        resetData,
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

  function ownsCase(sessionId, caseId) {
    const assignment = assignments.get(sessionId);
    return Boolean(assignment?.accepting && assignment.runId === current?.id
      && (!caseId || assignment.entry.caseIds.includes(caseId)));
  }

  async function validatedResult(input, test) {
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
    return { notes, checks: clone(checks), evidence: resolvedEvidence };
  }

  async function record(input, sessionId) {
    if (!current || current.phase !== 'running' || input.run_id !== current.id || !ownsCase(sessionId)) throw new Error('只有本轮测试会话可以提交结果。');
    const test = current.cases.find(test => test.id === input.case_id);
    if (!test || !ownsCase(sessionId, test.id) || !['passed', 'failed', 'blocked'].includes(input.status)) throw new Error('测试项目或结果状态无效，请只提交当前测试项。');
    const previous = current.results[test.id];
    if (previous.status !== 'pending') {
      if (previous.status !== input.status) throw new Error('已提交的结果不能被本批后续调用覆盖。');
      return { runId: current.id, caseId: test.id, status: previous.status, recordedAt: previous.recordedAt };
    }
    if (input.status === 'passed' && current.results[test.id].observation?.error
      && (input.correction?.kind !== 'test-error' || typeof input.correction.reason !== 'string' || input.correction.reason.trim().length < 15 || input.correction.reason.length > 2000)) {
      throw new Error('程序已记录失败，重试成功不能覆盖。仅确认测试定位或断言错误时，提供 correction:{kind:"test-error",reason:"具体错误及验证依据"}，并补齐全部检查和截图；产品偶发问题仍应 failed。');
    }
    if (input.status === 'passed' && current.results[test.id].observation?.error
      && current.controllerSessions.find(entry => entry.sessionId === sessionId)?.evidenceReview) {
      throw new Error('程序未完成时，图片验收不能直接改判通过；请先 inspect，在浏览器中补齐未执行步骤，再提交纠错依据。');
    }
    const { notes, checks, evidence: resolvedEvidence } = await validatedResult({ ...input, evidence: input.evidence ?? current.results[test.id].evidence }, test);
    // Disk reads above may yield while stop/completion changes the run state.
    if (current.phase !== 'running' || input.run_id !== current.id || !ownsCase(sessionId, test.id)) throw new Error('本轮测试已结束。');
    const settled = current.results[test.id];
    if (settled.status !== 'pending') {
      if (settled.status !== input.status) throw new Error('已提交的结果不能被并发调用覆盖。');
      return { runId: current.id, caseId: test.id, status: settled.status, recordedAt: settled.recordedAt };
    }
    current.results[test.id] = { ...current.results[test.id], stage: 'complete',
      status: input.status, checks: clone(checks), evidence: resolvedEvidence, notes,
      ...(input.correction ? { correction: clone(input.correction) } : {}), recordedAt: Date.now() };
    await persist();
    await assignments.get(sessionId)?.recorded();
    // The UI receives the full report through events/status. Returning it to the
    // model after every case needlessly repeats all cases, observations and paths.
    return { runId: current.id, caseId: test.id, status: input.status, recordedAt: current.results[test.id].recordedAt };
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
      if (['record', 'review', 'inspect'].includes(input.action) && !input.run_id && ownsCase(sessionId)) input = { ...input, run_id: assignments.get(sessionId).runId };
      if (input.action === 'list') return getCatalog();
      if (input.action === 'status') return getStatus(input.run_id);
      if (input.action === 'start') {
        if (sessionId && sessionId === current?.sessionId) throw new Error('测试会话不能启动另一轮自测。');
        return start(input.case_ids, { resetData: input.reset_data });
      }
      if (input.action === 'record') return record(input, sessionId);
      if (input.action === 'inspect') {
        if (!current || current.phase !== 'running' || input.run_id !== current.id || !ownsCase(sessionId)) throw new Error('只有本轮测试会话可以请求补查。');
        const entry = current.controllerSessions.find(item => item.sessionId === sessionId);
        const result = current.results[input.case_id];
        if (!entry?.evidenceReview || !ownsCase(sessionId, input.case_id) || result?.status !== 'pending'
          || typeof input.notes !== 'string' || input.notes.trim().length < 10 || input.notes.length > 2000) throw new Error('图片验收补查必须指定当前待核对项，并说明具体矛盾或缺失证据。');
        result.inspection = { sessionId, reason: input.notes.trim(), requestedAt: Date.now() };
        await persist(); await assignments.get(sessionId)?.recorded();
        return { runId: current.id, caseId: input.case_id, inspectionRequested: true };
      }
      if (input.action === 'review') {
        if (!current || current.phase !== 'running' || input.run_id !== current.id || !ownsCase(sessionId)) throw new Error('只有本轮测试会话可以提交结果。');
        if (!Array.isArray(input.reviews) || !input.reviews.length || input.reviews.length > REVIEW_BATCH_SIZE
          || new Set(input.reviews.map(item => item.case_id)).size !== input.reviews.length) throw new Error('批量核对格式无效。');
        const submissions = input.reviews.map(item => {
          const observation = current.results[item.case_id]?.observation;
          if (!ownsCase(sessionId, item.case_id) || !observation || observation.error || item.status !== 'passed'
            || typeof item.notes !== 'string' || item.notes.trim().length < 10) throw new Error('仅完整页面检查可直接确认；异常请用 record 提交逐条观察和证据。');
          return { ...item, run_id: input.run_id, checks: observation.checks, evidence: observation.evidence };
        });
        const receipts = [];
        for (const submission of submissions) receipts.push(await record(submission, sessionId));
        return { recorded: receipts };
      }
      if (input.action === 'stop') return stop(input.run_id);
      throw new Error('未知自测操作。');
    },
  };
}
