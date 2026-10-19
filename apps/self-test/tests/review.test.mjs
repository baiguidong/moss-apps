import { test, expect, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSelfTestService } from '../src/backend/service.mjs';
import { buildReviewPrompt } from '../src/backend/review-prompt.mjs';
const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture({ executeController, executeRecipe, reviewTimeoutMs, ...options } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-review-')); roots.push(directory);
  const controllers = [], executions = [], configs = [];
  let service;
  service = createSelfTestService({ directory, catalogDirectory: fileURLToPath(new URL('../resources/self-tests', import.meta.url)),
    getSettings: () => ({ model: 'review-model' }), prepareBrowser: async () => ({ version: 'test', config: () => ({}) }),
    reviewTimeoutMs, ...options,
    launchInstance: async () => ({ endpoint: 'test', exited: new Promise(() => {}), isAlive: () => true }),
    createController: async (run, config) => { configs.push(config); const id = 'review-' + controllers.length; controllers.push(id); return id; },
    stopController: async () => {}, interruptController: async () => {},
    executeRecipe: executeRecipe || (async (run, test) => {
      executions.push(test.id);
      const file = test.id + '.png'; await fs.writeFile(path.join(run.evidenceDir, file), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG9sAAAAASUVORK5CYII=', 'base64'));
      return { caseId: test.id, checks: test.expected.map((_, index) => ({ index, passed: true, actual: 'Observed actual UI state' })), evidence: [file] };
    }),
    executeController: async (sessionId, prompt, signal, options) => executeController?.({ service, sessionId, prompt, signal, options }),
  });
  return { service, controllers, executions, configs, directory };
}
const confirm = async ({ service, sessionId }) => {
  const run = service.snapshot();
  return service.handle({ action: 'review', run_id: run.id, reviews: run.activeCaseIds.filter(id => run.results[id].status === 'pending')
    .map(case_id => ({ case_id, status: 'passed', notes: '已逐条核对本轮真实截图，内容与页面断言一致。' })) }, sessionId);
};
test('fresh bounded review batches exclude unrelated catalog, history and script source', async () => {
  const prompts = [];
  const f = await fixture({ executeController: async value => { prompts.push(value.prompt); await confirm(value); } });
  await f.service.start(['startup', 'appearance', 'chat-appearance', 'settings-navigation', 'runtime-settings', 'memory-settings']);
  await f.service.waitForIdle();
  const run = f.service.snapshot();
  expect(run.phase).toBe('completed');
  expect(f.controllers).toHaveLength(2);
  expect(f.executions).toHaveLength(6);
  expect(run.controllerSessions.every(session => session.caseIds.length <= 3)).toBe(true);
  expect(prompts.every(prompt => prompt.length < 9000 && !prompt.includes('async (initialPage)') && !prompt.includes('workflow-demo'))).toBe(true);
  expect(prompts[1]).not.toContain('startup');
  expect(run.results.startup.observation.evidence).toEqual(['startup.png']);
  expect(run.results.startup.controllerSessionId).not.toBe(run.results['memory-settings'].controllerSessionId);
});
test('missing submissions get one repair turn without rerunning successful operations', async () => {
  let turns = 0;
  const f = await fixture({ executeController: async value => { if (++turns === 2) await confirm(value); } });
  await f.service.start(['startup']); await f.service.waitForIdle();
  expect(turns).toBe(2); expect(f.executions).toEqual(['startup']); expect(f.service.snapshot().phase).toBe('completed');
});
test('a repeated false completion stays blocked with all evidence retained', async () => {
  let turns = 0;
  const f = await fixture({ executeController: async () => { turns++; } });
  await f.service.start(['startup']); await f.service.waitForIdle();
  const result = f.service.snapshot().results.startup;
  expect(turns).toBe(2); expect(result.status).toBe('blocked');
  expect(result.checks).toHaveLength(2); expect(result.evidence).toEqual(['startup.png']);
  expect(result.notes).toContain('补交一次');
});
test('a batch deadline preserves submitted results and does not reset its exhausted budget', async () => {
  let calls = 0;
  const f = await fixture({ reviewTimeoutMs: 40, executeController: async ({service,sessionId,signal}) => {
    calls++;
    await service.handle({action:'review',run_id:service.snapshot().id,reviews:[{case_id:'startup',status:'passed',notes:'主界面和设置截图完整，无白屏或布局遮挡。'}]},sessionId);
    await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  await f.service.start(['startup','appearance','chat-appearance']); await f.service.waitForIdle();
  const run=f.service.snapshot();
  expect(calls).toBe(1); expect(f.controllers).toHaveLength(1);
  expect(run.results.startup.status).toBe('passed');
  expect(run.results.appearance.status).toBe('blocked');
  expect(run.results['chat-appearance'].status).toBe('blocked');
  expect(run.controllerSessions[0].timedOut).toBe(true);
  expect(f.executions).toEqual(['startup','appearance','chat-appearance']);
});
test('timeout recovery is bounded when no controller ever submits', async () => {
  const f = await fixture({ reviewTimeoutMs: 15, executeController: async ({ signal }) => {
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  await f.service.start(['startup']); await f.service.waitForIdle();
  expect(f.controllers).toHaveLength(1); expect(f.executions).toEqual(['startup']);
  expect(f.service.snapshot().results.startup.status).toBe('blocked');
});
test('failed program observations cannot be bulk approved and UI cannot impersonate a reviewer', async () => {
  const f = await fixture({ executeRecipe: async () => ({ error: 'PDF stayed blank', evidence: [] }),
    executeController: async ({ service, sessionId }) => {
      const run = service.snapshot();
      const input = { action: 'review', run_id: run.id, reviews: [{ case_id: 'startup', status: 'passed', notes: '已核对本轮真实截图，内容与页面断言一致。' }] };
      await expect(service.handle(input, 'unrelated')).rejects.toThrow('只有本轮测试会话');
      await expect(service.handle(input, sessionId)).rejects.toThrow('完整页面检查');
    },
  });
  await f.service.start(['startup']); await f.service.waitForIdle();
  expect(f.service.snapshot().results.startup.status).toBe('blocked');
  expect(f.service.snapshot().results.startup.observation.error).toBe('PDF stayed blank');
});
test('stopping during direct execution aborts it and never starts a reviewer', async () => {
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const f = await fixture({ executeRecipe: async (_run, _test, signal) => {
    entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  await f.service.start(['startup']); await ready; f.service.stop(); await f.service.waitForIdle();
  expect(f.controllers).toEqual([]); expect(f.service.snapshot().phase).toBe('canceled');
});

test('evidence review receives current screenshots on its first request', async () => {
  const f = await fixture({ executeController: async value => {
    expect(value.options.evidence).toEqual(['startup.png', 'appearance.png']);
    expect(value.prompt).toContain('本消息已附本批全部截图');
    await confirm(value);
  } });
  await f.service.start(['startup', 'appearance']); await f.service.waitForIdle();
  expect(f.configs.map(config => config.evidenceReview)).toEqual([true]);
  expect(f.service.snapshot().results.startup.status).toBe('passed');
});
test('visual ambiguity escalates only the named case, never replays successful scripts', async () => {
  let calls = 0;
  const f = await fixture({ executeController: async value => {
    const { service, sessionId } = value, run = service.snapshot();
    if (++calls === 1) {
      await expect(service.handle({ action: 'inspect', run_id: run.id, case_id: 'startup', notes: '首页截图中的文字被遮挡，需要检查可读性。' }, 'foreign')).rejects.toThrow();
      await service.handle({ action: 'inspect', run_id: run.id, case_id: 'startup', notes: '首页截图中的文字被遮挡，需要检查可读性。' }, sessionId);
      await service.handle({ action: 'review', run_id: run.id, reviews: [{case_id:'appearance',status:'passed',notes:'主题截图内容完整、布局与已执行的断言一致。'}] }, sessionId);
    } else {
      expect(run.activeCaseIds).toEqual(['startup']);
      expect(value.options.evidence).toEqual(['startup.png']);
      expect(value.prompt).toContain('首页截图中的文字被遮挡');
      await expect(service.handle({ action: 'inspect', run_id: run.id, case_id: 'startup', notes: '不允许无限请求再次补充截图检查。' }, sessionId)).rejects.toThrow();
      await service.handle({ action: 'record', run_id: run.id, case_id: 'startup', status:'failed', checks:[{index:0,passed:false,actual:'实际标题被遮挡'}],evidence:run.results.startup.evidence,notes:'补查确认标题被遮挡。' },sessionId);
    }
  } });
  await f.service.start(['startup','appearance']); await f.service.waitForIdle();
  const run=f.service.snapshot();
  expect(calls).toBe(2); expect(f.configs.map(c=>c.evidenceReview)).toEqual([true,false]);
  expect(f.executions).toEqual(['startup','appearance']);
  expect(run.results.startup.status).toBe('failed'); expect(run.results.appearance.status).toBe('passed');
  expect(run.results.appearance.controllerSessionId).toBe(f.controllers[0]);
});
test('a visual defect can fail a case despite all successful program assertions', async () => {
  const f = await fixture({ executeController: async ({service,sessionId}) => {
    const run=service.snapshot();
    await service.handle({action:'record',run_id:run.id,case_id:'startup',status:'failed',checks:[{index:0,passed:false,actual:'截图有大面积文字重叠'}],evidence:run.results.startup.evidence,notes:'真实截图显示文字重叠，无法正常阅读。'},sessionId);
  } });
  await f.service.start(['startup']); await f.service.waitForIdle();
  expect(f.service.snapshot().results.startup.status).toBe('failed');
  expect(f.service.snapshot().results.startup.observation.checks.every(c=>c.passed)).toBe(true);
});
test('an error with screenshots gets evidence triage before any browser diagnosis', async () => {
  const f = await fixture({ executeRecipe: async (run) => {
    await fs.writeFile(path.join(run.evidenceDir, 'failed.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG9sAAAAASUVORK5CYII=', 'base64'));
    return {error:'点击停止后仍在输出，超过 15 秒',evidence:['failed.png']};
  }, executeController: async ({service,sessionId,options}) => {
    const run=service.snapshot();
    expect(options.evidence).toEqual(['failed.png']);
    await service.handle({action:'record',run_id:run.id,case_id:'startup',status:'failed',checks:[],evidence:['failed.png'],notes:'截图与失败位置一致，停止后实际输出没有停止。'},sessionId);
  } });
  await f.service.start(['startup']); await f.service.waitForIdle();
  expect(f.configs.map(c=>c.evidenceReview)).toEqual([true]);
  expect(f.service.snapshot().results.startup.status).toBe('failed');
});
test('retry success cannot silently overwrite an observed failure', async () => {
  const f = await fixture({ executeRecipe: async run => {
    await fs.writeFile(path.join(run.evidenceDir,'failure.png'), Buffer.from('89504e470d0a1a0a','hex'));
    return {error:'停止点击后仍持续输出',evidence:['failure.png']};
  }, executeController: async ({service,sessionId}) => {
    const run=service.snapshot();
    const submission={action:'record',run_id:run.id,case_id:'startup',status:'passed',checks:run.cases[0].expected.map((_,index)=>({index,passed:true,actual:'第二次重试成功'})),evidence:['failure.png'],notes:'第二次重试成功。'};
    await expect(service.handle(submission,sessionId)).rejects.toThrow('重试成功不能覆盖');
    await service.handle({...submission,status:'failed',notes:'第一次停止无效，即使第二次恢复也保留偶发失败。'},sessionId);
  } });
  await f.service.start(['startup']); await f.service.waitForIdle();
  expect(f.service.snapshot().results.startup.status).toBe('failed');
});

test('a screenshot reviewer cannot approve unfinished steps using a test-error correction', async () => {
  let turns = 0;
  const f = await fixture({ executeRecipe: async run => {
    await fs.writeFile(path.join(run.evidenceDir, 'partial.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG9sAAAAASUVORK5CYII=', 'base64'));
    return { error: 'Ambiguous locator before opening the report', evidence: ['partial.png'] };
  }, executeController: async ({ service, sessionId }) => {
    const run = service.snapshot();
    const submission = { action: 'record', run_id: run.id, case_id: 'startup', status: 'passed',
      checks: run.cases[0].expected.map((_, index) => ({ index, passed: true, actual: '实际补查了全部步骤' })),
      evidence: ['partial.png'], notes: '已纠正测试定位并补查。',
      correction: { kind: 'test-error', reason: '原定位同时匹配两个回复，产品正常；已补查余下步骤及实际报告。' } };
    if (++turns === 1) {
      await expect(service.handle(submission, sessionId)).rejects.toThrow('图片验收不能直接改判通过');
      await service.handle({ action: 'inspect', run_id: run.id, case_id: 'startup', notes: '报错发生在报告打开之前，需要实际打开报告补齐缺失步骤。' }, sessionId);
    } else await service.handle(submission, sessionId);
  } });
  await f.service.start(['startup']); await f.service.waitForIdle();
  expect(f.configs.map(config => config.evidenceReview)).toEqual([true, false]);
  expect(f.service.snapshot().results.startup.status).toBe('passed');
});

function deferred() { let resolve; const promise=new Promise(r=>{resolve=r}); return {promise,resolve}; }
test('page checks advance while a reviewer waits, and late submissions stay bound to their original cases', async () => {
  const reviewing=deferred(), advanced=deferred(), release=deferred();
  const executed=[]; let firstSession;
  const f=await fixture({batchWaitMs:10,executeRecipe:async(run,test)=>{
    executed.push(test.id);
    if(test.id==='settings-navigation') { await reviewing.promise; advanced.resolve(); }
    const file=test.id+'.png'; await fs.writeFile(path.join(run.evidenceDir,file),Buffer.from('89504e470d0a1a0a','hex'));
    return {checks:test.expected.map((_,index)=>({index,passed:true,actual:'UI observed'})),evidence:[file]};
  },executeController:async value=>{
    if(!firstSession) { firstSession=value.sessionId; reviewing.resolve(); await release.promise;
      const run=value.service.snapshot();
      await expect(value.service.handle({action:'review',run_id:run.id,reviews:[{case_id:'settings-navigation',status:'passed',notes:'错误批次不允许提交另一个项目的结果。'}]},value.sessionId)).rejects.toThrow();
    }
    await confirm(value);
  }});
  await f.service.start(['startup','appearance','chat-appearance','settings-navigation','runtime-settings','memory-settings']);
  await advanced.promise;
  expect(f.service.snapshot().results.startup.status).toBe('pending');
  expect(executed).toContain('settings-navigation');
  release.resolve(); await f.service.waitForIdle();
  expect(f.service.snapshot().phase).toBe('completed');
  await expect(confirm({service:f.service,sessionId:firstSession})).rejects.toThrow();
});
test('browser diagnoses wait until independent fixed checks have finished',async()=>{
  const executed=[]; let turns=0;
  const f=await fixture({executeRecipe:async(run,test)=>{
    executed.push(test.id);const file=test.id+'.png';await fs.writeFile(path.join(run.evidenceDir,file),Buffer.from('89504e470d0a1a0a','hex'));
    return {checks:test.expected.map((_,index)=>({index,passed:true,actual:'actual control visible'})),evidence:[file]};
  },executeController:async value=>{
    const run=value.service.snapshot(),entry=run.controllerSessions.find(c=>c.sessionId===value.sessionId);
    if(entry.evidenceReview) {
      if(entry.caseIds.includes('startup')) await value.service.handle({action:'inspect',run_id:run.id,case_id:'startup',notes:'首页截图存在遮挡，需要单独重新定位补查。'},value.sessionId);
      const ids=entry.caseIds.filter(id=>id!=='startup');
      if(ids.length) await value.service.handle({action:'review',run_id:run.id,reviews:ids.map(case_id=>({case_id,status:'passed',notes:'页面截图和操作断言一致，没有观察到异常。'}))},value.sessionId);
    } else {
      turns++;expect(executed).toHaveLength(6);
      await value.service.handle({action:'record',run_id:run.id,case_id:'startup',status:'failed',checks:[],evidence:run.results.startup.evidence,notes:'单独补查确认首页存在遮挡。'},value.sessionId);
    }
  }});
  await f.service.start(['startup','appearance','chat-appearance','settings-navigation','runtime-settings','memory-settings']);await f.service.waitForIdle();
  expect(turns).toBe(1);expect(f.service.snapshot().results['memory-settings'].status).toBe('passed');
});

test('trusted assignment supplies run id and completes only after all receipts', async () => {
  const finishes = [];
  const f = await fixture({ finishController: async id => { finishes.push(id); }, executeController: async ({ service, sessionId }) => {
    const ids = service.snapshot().activeCaseIds;
    for (const [index, case_id] of ids.entries()) {
      expect(finishes).toHaveLength(0);
      const receipt = await service.handle({ action: 'review', reviews: [{ case_id, status: 'passed', notes: '已检查全部截图的内容、布局和可读性，与页面事实一致。' }] }, sessionId);
      expect(receipt.recorded[0].caseId).toBe(case_id);
      if (index === ids.length - 1) expect(finishes).toEqual([sessionId]);
    }
  } });
  await f.service.start(['startup', 'appearance']); await f.service.waitForIdle();
  expect(f.service.snapshot().phase).toBe('completed'); expect(finishes).toHaveLength(1);
});

test('concurrent conflicting submissions settle a case exactly once', async () => {
  const f = await fixture({ executeController: async ({ service, sessionId }) => {
    const run = service.snapshot(), observation = run.results.startup.observation;
    const submissions = await Promise.allSettled(['passed', 'failed'].map(status => service.handle({ action: 'record', case_id: 'startup', status,
      notes: 'Concurrent result must not replace an already accepted conclusion.', checks: observation.checks, evidence: observation.evidence }, sessionId)));
    expect(submissions.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(submissions.filter(item => item.status === 'rejected')).toHaveLength(1);
  } });
  await f.service.start(['startup']); await f.service.waitForIdle();
  expect(f.service.snapshot().results.startup.recordedAt).toBeGreaterThan(0);
});
