// Run after build with Moss's Electron: ../moss/ui/node_modules/.bin/electron apps/sequential-thinking/scripts/verify-ui.mjs
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(path.join(root, 'app.moss.json'), 'utf8'))
const output = path.resolve(root, '../../artifacts', manifest.id, 'verification', manifest.version)
const temporary = await mkdtemp(path.join(tmpdir(), 'moss-thinking-ui-'))
app.setPath('userData', path.join(temporary, 'profile'))
app.on('window-all-closed', () => {})
let win
const errors = []
const watchdog = setTimeout(() => { console.error('UI verification timed out'); app.exit(1) }, 45_000)
const evaluate = fn => win.webContents.executeJavaScript(`(${fn})()`)
async function capture(name) {
  await new Promise(resolve => setTimeout(resolve, 200))
  await writeFile(path.join(output, name), (await win.webContents.capturePage()).toPNG())
}
async function until(fn, message) {
  for (let index = 0; index < 100; index++) {
    if (await evaluate(fn)) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error(`${message}: ${errors.join('\n')}`)
}
async function run() {
try {
  const preload = path.join(temporary, 'preload.cjs')
  await writeFile(preload, `
const listeners = new Map();
const emit = name => { for (const callback of listeners.get(name) || []) callback({}); };
const tool = { name: 'sequentialthinking', description: 'Thoughts', disabled: false };
const fixture = window.thinkingFixture = { state: 'connecting', failure: null, theme: 'light', reconnects: 0, emit,
  listeners: () => [...listeners.values()].reduce((sum, list) => sum + list.size, 0) };
window.mossApp = {
  app: { getInfo: async () => ({ appearance: { themeMode: fixture.theme } }) },
  actions: { cancel: async () => ({ cancelled: true }), invoke: async (method, input) => {
    if (Object.keys(input).length) throw new Error('Unexpected input');
    if (fixture.failure) return { ok: false, error: { code: 'UNAVAILABLE', message: fixture.failure } };
    if (method === 'servers.inspect') {
      fixture.reconnects++; fixture.state = 'connecting'; emit('thinking.changed');
      setTimeout(() => { fixture.state = 'ready'; emit('thinking.changed'); }, 150);
    }
    return { ok: true, result: { ok: true, data: {
      preparation: { state: fixture.state, ...(fixture.state === 'failed' ? { error: '服务连接失败' } : {}) },
      servers: [{ name: 'sequential-thinking', enabled: true, check: { state: fixture.state === 'ready' ? 'connected' : 'failed', checkedAt: 1791763200000, tools: [tool] } }]
    } } };
  } },
  events: { on: (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); return () => listeners.get(name).delete(callback); } }
};
`)
  win = new BrowserWindow({ show: false, width: 820, height: 920, webPreferences: {
    preload, contextIsolation: false, sandbox: false, backgroundThrottling: false,
  } })
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2 && !message.includes('Electron Security Warning')) errors.push(message) })
  await win.loadFile(path.join(root, manifest.ui.entry), { hash: '/settings' })
  await until(() => document.querySelector('#status')?.textContent === '连接中', 'Initial connection state missing')
  assert.equal(await evaluate(() => document.querySelector('#reconnect').disabled), true)
  await evaluate(() => { window.thinkingFixture.state = 'ready'; window.thinkingFixture.emit('thinking.changed') })
  await until(() => document.querySelector('#status').textContent === '已连接', 'Ready event lost')
  assert.equal(await evaluate(() => document.querySelector('#tool-count').textContent), '1 个可用工具')
  assert.equal(await evaluate(() => document.querySelector('#tools h3').textContent), 'sequentialthinking')
  await mkdir(output, { recursive: true })
  await capture('settings-light.png')
  await evaluate(() => { window.thinkingFixture.failure = '暂时无法连接 Host'; document.querySelector('#refresh').click() })
  await until(() => document.querySelector('#status').textContent === '读取失败', 'Host failure hidden')
  assert.equal(await evaluate(() => document.querySelector('#error').textContent), '暂时无法连接 Host')
  assert.equal(await evaluate(() => document.querySelector('#tools h3')), null)
  await evaluate(() => { window.thinkingFixture.failure = null; window.thinkingFixture.state = 'failed'; document.querySelector('#refresh').click() })
  await until(() => document.querySelector('#status').textContent === '连接失败', 'Service failure hidden')
  await evaluate(() => document.querySelector('#reconnect').click())
  await until(() => document.querySelector('#status').textContent === '已连接', 'Reconnect did not recover')
  assert.equal(await evaluate(() => window.thinkingFixture.reconnects), 1)
  assert.equal(await evaluate(() => document.querySelector('#error').hidden), true)
  await evaluate(() => { window.thinkingFixture.theme = 'dark'; window.thinkingFixture.emit('appearance') })
  await until(() => document.documentElement.dataset.theme === 'dark', 'Host theme not applied')
  await capture('settings-dark.png')
  win.setSize(380, 820)
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(await evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await capture('settings-narrow.png')
  await evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  assert.equal(await evaluate(() => window.thinkingFixture.listeners()), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: built settings UI, connection events, Host/service errors, reconnect, themes, narrow layout and cleanup')
} catch (error) { console.error(error); process.exitCode = 1 }
finally {
  win?.destroy()
  try { await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
  catch (error) { console.error(error); process.exitCode = 1 }
  finally { clearTimeout(watchdog); app.exit(process.exitCode || 0) }
}
}
app.whenReady().then(run)
