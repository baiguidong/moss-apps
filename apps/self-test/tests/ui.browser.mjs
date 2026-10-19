// Run after build: node tests/ui.browser.mjs [artifact-directory]
// These fixtures exercise the rendered UI; model/CDP acceptance runs in Core.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../dist/ui', import.meta.url));
const output = path.resolve(process.argv[2] || '/tmp/moss-self-test-ui');
await fs.mkdir(output, { recursive: true });
const catalog = JSON.parse(await fs.readFile(new URL('../resources/self-tests/catalog.json', import.meta.url), 'utf8'));
const server = createServer(async (req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(await fs.access(chromium.executablePath()).then(() => ({}), () => ({ channel: 'chrome' })));
try {
  const page = await browser.newPage({ viewport: { width: 980, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ catalog }) => {
    const listeners = new Map();
    const emit = (name, state) => { for (const fn of listeners.get(name) || []) fn(structuredClone(state)); };
    let status = { phase: 'idle', message: '' };
    const instance = { phase: 'open', prepared: true, message: '测试实例已打开；测试结束后保留窗口和数据。', home: '/fixture', directory: '/fixture' };
    let theme = 'light';
    window.__test = {
      setTheme(value) { theme = value; emit('appearance', {}); },
      setStatus(value) { status = { ...status, ...value }; emit('self-test.changed', status); },
      getStatus() { return status; },
    };
    window.mossApp = {
      app: { getInfo: async () => ({ id: 'moss.self-test', appearance: { themeMode: theme, cssThemeId: 'default' } }) },
      events: { on(name, fn) { const set = listeners.get(name) || new Set(); listeners.set(name, set); set.add(fn); return () => set.delete(fn); } },
      actions: {
        cancel: async () => {},
        async invoke(name, input) {
          if (name === 'catalog') return { ok: true, result: catalog };
          if (name === 'instance.sync') return { ok: false, error: { message: '同步失败，请检查测试实例。' } };
          if (name.startsWith('instance.')) return { ok: true, result: instance };
          if (name === 'run.start') {
            const cases = catalog.cases.filter(test => input.caseIds.includes(test.id));
            status = { phase: 'running', executionMode: 'pipeline', id: '12345678-1234-1234-1234-123456789abc', model: 'gpt-5.5', sessionId: 'controller', message: '正在执行测试', resetData: input.resetData, environmentReadyAt: Date.now() - 16000, controllerReadyAt: Date.now() - 15000, startedAt: Date.now() - 18000, activeCaseId: cases[0].id, cases,
              results: Object.fromEntries(cases.map((test, i) => [test.id, { status: 'pending', ...(i === 0 ? { startedAt: Date.now() - 15000 } : {}) }])), reportPath: '/fixture/report.json', inheritedApps: [{ id: 'moss.self-test' }] };
            emit('self-test.changed', status);
          }
          if (name === 'run.stop') { status = { ...status, phase: 'canceled', activeCaseId: null, finishedAt: Date.now(), message: '测试已停止，窗口和数据已保留。' }; emit('self-test.changed', status); }
          return { ok: true, result: status };
        },
      },
    };
  }, { catalog });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.getByRole('button', { name: '开始自测', exact: true }).waitFor();
  await page.waitForFunction(count => document.querySelectorAll('.case-select input:checked').length === count, catalog.cases.filter(test => test.default).length);
  assert.equal(await page.locator('.case-group').count(), new Set(catalog.cases.map(test => test.group)).size);
  await page.getByRole('combobox', { name: '测试模块' }).selectOption('多格式预览');
  assert.equal(await page.locator('.case-select input').count(), catalog.cases.filter(test => test.group === '多格式预览').length);
  await page.getByRole('button', { name: '选择多格式预览全部项目', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '取消多格式预览全部项目', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: '取消多格式预览全部项目', exact: true }).click();
  assert.equal(await page.locator('.case-select input:checked').count(), 0);
  await page.getByRole('searchbox', { name: '搜索测试项目' }).fill('PDF');
  assert.equal(await page.locator('.case-select input').count(), 1);
  await page.getByRole('searchbox', { name: '搜索测试项目' }).fill('NO_MATCH');
  await page.getByText('没有匹配项目，请调整搜索或模块。').waitFor();
  await page.getByRole('searchbox', { name: '搜索测试项目' }).fill('');
  await page.getByRole('combobox', { name: '测试模块' }).selectOption('全部模块');
  await page.getByRole('button', { name: '默认项目' }).click();
  await page.screenshot({ path: path.join(output, 'light-idle.png') });
  await page.getByRole('button', { name: '界面检查' }).click();
  assert.equal(await page.locator('.case-select input:checked').count(), catalog.cases.filter(test => !test.requiresModel).length);
  await page.getByRole('button', { name: '开始自测', exact: true }).click();
  await page.getByRole('button', { name: '停止自测', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox').first().isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__test.getStatus().resetData), true);
  await page.getByLabel('当前测试详情').getByText('本项检查内容', { exact: true }).waitFor();
  await page.getByLabel('分阶段耗时').waitFor();
  await page.getByLabel('执行与验收进度').getByText('页面检查', { exact: false }).waitFor();
  await page.evaluate(() => {
    const run = window.__test.getStatus();
    window.__test.setStatus({ executionCaseId: run.cases[1].id, controllerSessions: [{ sessionId: 'review-1', caseIds: [run.activeCaseId], startedAt: Date.now() - 1000 }],
      results: { ...run.results, [run.activeCaseId]: { ...run.results[run.activeCaseId], stage: 'review', executionMs: 1200, executionFinishedAt: Date.now() - 2000, observation: { checks: [], evidence: [] } } } });
  });
  await page.getByText('AI 核对中', { exact: true }).waitFor();
  await page.evaluate(() => window.__test.setTheme('dark'));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: path.join(output, 'dark-running.png'), fullPage: false });
  await page.getByRole('button', { name: '停止自测', exact: true }).click();
  await page.getByText('本轮已停止', { exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox').first().isDisabled(), false);
  await page.getByRole('button', { name: '开始自测', exact: true }).click();
  await page.evaluate(() => {
    const run = window.__test.getStatus();
    const results = Object.fromEntries(run.cases.map((test, i) => [test.id, { status: i === 1 ? 'failed' : 'passed', startedAt: run.startedAt + i * 1000, finishedAt: run.startedAt + i * 1000 + 1000, notes: i === 1 ? '重新打开设置后，主题选择未保留。' : '界面状态与预期一致。', evidence: ['screenshot.png'], checks: [{ index: 0, passed: i !== 1, actual: i === 1 ? '保存深色后重新打开，实际显示浅色。' : '已通过实际页面操作验证。' }] }]));
    window.__test.setStatus({ phase: 'failed', activeCaseId: null, finishedAt: Date.now(), results, message: '测试结束，存在未达预期项目。' });
    window.__test.setTheme('light');
  });
  await page.getByText('检查结束，存在问题', { exact: true }).waitFor();
  await page.locator('.case-item').filter({ has: page.getByRole('checkbox', { name: '设置与主题保存', exact: true }) }).locator('summary').click();
  await page.getByText('重新打开设置后，主题选择未保留。', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'light-results.png'), fullPage: false });
  await page.getByRole('button', { name: '重测问题项' }).click();
  assert.equal(await page.locator('.case-select input:checked').count(), 1);
  assert.equal(await page.getByRole('checkbox', { name: '设置与主题保存', exact: true }).isChecked(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'mobile-results.png'), animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal overflow on narrow windows');
  await page.locator('.environment-details > summary').click();
  await page.getByRole('button', { name: '同步主 Moss 环境', exact: true }).click();
  await page.getByRole('alert').getByText('同步失败，请检查测试实例。').waitFor();
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, checks: ['default selection', 'module filter', 'group selection', 'keyword search', 'empty results', 'retry problem cases', 'UI preset', 'start and progress', 'selection locked during run', 'theme sync', 'stop retains results', 'failure details', 'narrow viewport', 'action error'], screenshots: ['light-idle.png', 'dark-running.png', 'light-results.png', 'mobile-results.png'] }, null, 2));
  console.log(`UI verification passed: ${output}`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
