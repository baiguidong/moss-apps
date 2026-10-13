import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildAppSettings } from '../build.mjs';

// Use the App's browser-test dependency, just as the App consumes the shared UI.
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const require = createRequire(path.join(repo, 'apps/mcp/package.json'));
const { chromium, expect } = require('@playwright/test');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-shared-settings-'));
const output = process.env.APP_SETTINGS_SCREENSHOTS;
let browser, server;
const calls = [];
const states = new Map();
try {
  for (const name of ['mcp', 'library', 'sequential-thinking']) {
    const target = path.join(temp, name); await fs.mkdir(target, { recursive: true });
    const html = await buildAppSettings(path.join(repo, 'apps', name), { outputDir: target, html: '<!doctype html><meta charset="utf-8"><body><main><input aria-label="App 工作内容" value="保留内容"></main></body>' });
    await fs.writeFile(path.join(target, 'index.html'), html);
    states.set(name, { defaultScope: name === 'sequential-thinking' ? 'global' : 'session', override: null, grants: ['mcp:read', 'mcp:connect', 'mcp:manage', 'mcp:auth'],
      servers: [{ name: 'drawio', enabled: true, updatedAt: 1000, credentialsMissing: false,
        config: { type: 'stdio', command: 'npx', args: ['-y', '@drawio/mcp'], env: { API_KEY: '' } }, check: null }] });
  }
  server = createServer(async (request, response) => {
    try {
      const file = path.resolve(temp, '.' + new URL(request.url, 'http://localhost').pathname);
      if (!file.startsWith(temp + path.sep)) throw new Error('Invalid path');
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { channel: 'chrome' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1120, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('installation', name => ({ installation: { enabled: true, grants: states.get(name).grants } }));
  await page.exposeFunction('hostRequest', (name, protocol, method, input) => {
    calls.push({ name, protocol, method, input });
    const state = states.get(name);
    if (protocol === 'moss.host/v1') {
      if (method === 'tools.scope.set') {
        if (state.failSave) { state.failSave = false; return { ok: false, error: { message: '保存失败，请重试', code: 'APP_HOST_UNAVAILABLE' } }; }
        state.override = input.scope;
      }
      return { ok: true, result: { scope: state.override ?? state.defaultScope, defaultScope: state.defaultScope, overridden: state.override !== null } };
    }
    const server = state.servers.find(server => server.name === input.name);
    if (method === 'servers.inspect') server.check = { state: 'connected', checkedAt: Date.now(), tools: [{ name: 'create_diagram', description: '创建并编辑图表', disabled: false }] };
    if (method === 'servers.save') Object.assign(server, { config: input.config, updatedAt: Date.now() });
    if (method === 'servers.set-enabled') Object.assign(server, { enabled: input.enabled, updatedAt: Date.now() });
    return { ok: true, result: { servers: state.servers } };
  });
  await page.addInitScript(() => {
    const name = location.pathname.split('/')[1];
    window.mossApp = {
      app: { getInstallationState: () => window.installation(name) },
      events: { on: () => () => {} },
      host: { cancel: async () => {}, request: (protocol, method, input) => window.hostRequest(name, protocol, method, input) },
    };
  });
  const url = name => `http://127.0.0.1:${server.address().port}/${name}/index.html`;
  await page.goto(url('mcp') + '#/moss-settings');
  await expect(page.getByRole('radio', { name: /跟随 App 默认/ })).toBeChecked();
  await expect(page.getByText('当前默认：指定会话。随 App 默认设置更新。')).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: '连接配置' })).toContainText('@drawio/mcp');
  await page.getByRole('radio', { name: /^全局/ }).click();
  await expect(page.getByText('当前生效：全局。正在执行的会话下一轮生效。')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: /^全局/ })).toBeChecked();
  states.get('mcp').failSave = true;
  await page.getByRole('radio', { name: /^指定会话/ }).click();
  await expect(page.getByRole('alert')).toContainText('保存失败');
  await expect(page.getByRole('radio', { name: /^全局/ })).toBeChecked();
  await page.getByRole('radio', { name: /跟随 App 默认/ }).click();
  await expect(page.getByRole('radio', { name: /跟随 App 默认/ })).toBeChecked();
  await page.getByRole('button', { name: '检查连接', exact: true }).click();
  await page.getByRole('tab', { name: /可用工具/ }).click();
  await expect(page.getByRole('tabpanel', { name: '可用工具' })).toContainText('create_diagram');
  await page.getByRole('tab', { name: '连接配置' }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('启动命令', { exact: true }).fill('node');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: '连接配置' }).getByText('node', { exact: true })).toBeVisible();
  assert.deepEqual(states.get('mcp').servers[0].config.env, { API_KEY: '' });
  await page.getByRole('switch', { name: '启用 drawio' }).click();
  await expect(page.getByRole('switch', { name: '启用 drawio' })).not.toBeChecked();
  await page.getByRole('switch', { name: '启用 drawio' }).click();
  await expect(page.getByRole('switch', { name: '启用 drawio' })).toBeChecked();
  await page.locator('[data-moss-app-settings]').evaluate(element => { element.scrollTop = 0; });
  assert.equal(await page.locator('[data-mcp-service]').evaluate(element => getComputedStyle(element).borderTopStyle), 'solid');
  if (output) { await fs.mkdir(output, { recursive: true }); await page.screenshot({ path: path.join(output, 'mcp-settings.png') }); }
  await page.setViewportSize({ width: 480, height: 820 });
  assert(await page.locator('[data-moss-app-settings]').evaluate(element => element.scrollWidth <= element.clientWidth));
  if (output) await page.screenshot({ path: path.join(output, 'mcp-settings-narrow.png') });
  await page.getByRole('button', { name: '返回应用', exact: true }).click();
  await expect(page.getByLabel('App 工作内容')).toHaveValue('保留内容');
  await page.goto(url('library') + '#/moss-settings');
  await expect(page.getByRole('radio', { name: /跟随 App 默认/ })).toBeChecked();
  await expect(page.getByRole('heading', { name: '可用工具' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'MCP 服务设置' })).toHaveCount(0);
  await page.goto(url('sequential-thinking') + '#/moss-settings');
  await expect(page.getByText('当前默认：全局。随 App 默认设置更新。')).toBeVisible();
  assert(calls.every(call => !('appId' in call.input)), 'App-bound SDK requests must not select another App');
  assert.deepEqual(errors, []);
  console.log('PASS: shared App settings, defaults/override/reset/persistence/failure, MCP config/tools/toggle, native tools, App isolation, narrow layout and route recovery');
} finally {
  await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
  await fs.rm(temp, { recursive: true, force: true });
}
