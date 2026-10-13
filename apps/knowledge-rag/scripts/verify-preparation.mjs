import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('..', import.meta.url))
const output = path.resolve(root, '../../artifacts/moss.knowledge-rag/preparation')
await fs.mkdir(output, { recursive: true })
const server = createServer(async (req, res) => {
  try {
    const target = path.join(root, 'dist/ui', new URL(req.url, 'http://localhost').pathname)
    const file = target.endsWith('/') ? `${target}index.html` : target
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
    res.end(await fs.readFile(file))
  } catch { res.writeHead(404); res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { channel: 'chrome' } : {}) })
  const page = await browser.newPage({ viewport: { width: 1160, height: 780 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const listeners = new Map(), calls = []
    let appearance = { themeMode: 'light', cssThemeId: 'default' }, scope = 'session'
    let state = { state: 'not-installed', installed: false, message: '', error: null, version: '4.11.0', model: 'intfloat/multilingual-e5-small' }
    const emit = (name, data) => (listeners.get(name) || []).forEach(fn => fn(data))
    const set = update => { state = { ...state, ...update }; emit('knowledge.changed', state) }
    const start = install => {
      const now = Date.now()
      set({ state: install ? 'installing' : 'starting', installed: !install, error: null,
        preparation: { steps: [['environment','运行环境'],['dependencies','引擎依赖'],['model','多语言模型'],['service','本地服务'],['index','恢复索引'],['connect','连接 Moss']].map(([id,label], i) => ({id,label,state: !install && i < 2 ? 'cached' : 'pending'})),
          stage: null, detail: '正在检查本地引擎…', observedAt: now, startedAt: now, elapsedMs: 0, stageElapsedMs: 0, idleMs: 0, download: null, logs: [] } })
    }
    const advance = (stage, detail, extra = {}) => {
      const progress = state.preparation, current = progress.steps.findIndex(step => step.id === stage)
      set({ preparation: { ...progress, stage, detail, download: null, observedAt: Date.now(),
        steps: progress.steps.map((step, i) => ({ ...step, state: step.state === 'cached' ? 'cached' : i < current ? 'done' : i === current ? 'active' : 'pending' })), ...extra } })
    }
    window.fixture = { set, advance, calls, appearance(value) { appearance = value; emit('appearance') } }
    window.mossApp = {
      app: { getInfo: async () => ({ id: 'moss.knowledge-rag', appearance }), getInstallationState: async () => ({ installation: { enabled: true, grants: [] } }) },
      events: { on(name, fn) { listeners.set(name, [...listeners.get(name) || [], fn]); return () => listeners.set(name, listeners.get(name).filter(item => item !== fn)) } },
      actions: { cancel: async () => {}, async invoke(name) {
        calls.push(name)
        if (name === 'engine.prepare') start(true)
        if (name === 'engine.start') start(false)
        if (name === 'engine.cancel') set({ state: 'failed', message: '已取消，可以稍后重试。', error: null })
        let result = state
        if (name === 'documents.list') result = { items: [{ filepath: 'note.md', filename: '产品资料.md' }], total: 1 }
        return { ok: true, result }
      } },
      host: { cancel: async () => {}, async request(_protocol, method, input) { if (_protocol === 'moss.mcp/v1') return { ok: true, result: { servers: [] } }; if (method === 'tools.scope.set') scope = input.scope || 'session'; return { ok: true, result: { scope, defaultScope: 'session', overridden: false } } } },
    }
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: '准备引擎', exact: true }).click()
  await page.evaluate(() => window.fixture.advance('dependencies', '正在下载并校验引擎依赖…', { logs: ['Downloading onnxruntime-1.26.0.whl (17.3 MB)'] }))
  await expect(page.locator('.latest-output')).toContainText('Downloading', { timeout: 1000 })
  await page.getByRole('button', { name: '取消准备', exact: true }).click()
  await page.evaluate(() => window.fixture.set({ installed: true, preparation: null }))
  await page.getByRole('button', { name: '启动 / 重试', exact: true }).click()
  await page.evaluate(() => window.fixture.advance('model', '正在下载模型文件 5/5：onnx/model_quantized.onnx', { elapsedMs: 45000, stageElapsedMs: 39000, download: { completed: 62 * 1024 * 1024, total: 118 * 1024 * 1024, file: 'onnx/model_quantized.onnx' } }))
  await expect(page.getByRole('progressbar', { name: '当前文件下载进度' })).toHaveAttribute('value', String(62 * 1024 * 1024))
  await expect(page.getByText('62.0 MB / 118.0 MB · 当前文件')).toBeVisible()
  await page.screenshot({ path: path.join(output, 'model-download.png') })
  await page.evaluate(() => window.fixture.advance('service', '正在检查已有索引，每次检查最多等待 30 秒…', { elapsedMs: 78000, stageElapsedMs: 31000, idleMs: 31000, logs: ['[PREFLIGHT] Checking existing index…'] }))
  await expect(page.getByRole('progressbar', { name: '当前步骤进行中' })).not.toHaveAttribute('value')
  await expect(page.locator('.setup-stalled')).toContainText('未收到新输出')
  await expect(page.locator('.setup-heading')).toContainText('当前步骤')
  await page.screenshot({ path: path.join(output, 'starting-light.png') })
  await page.getByText('查看详细输出', { exact: true }).click()
  await expect(page.locator('.setup-output pre')).toContainText('[PREFLIGHT]')
  await page.evaluate(() => window.fixture.appearance({ themeMode: 'dark', cssThemeId: 'grid-theme' }))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-background-style', 'grid-theme')
  assert.notEqual(await page.locator('.app-shell').evaluate(element => getComputedStyle(element).backgroundImage), 'none')
  await page.screenshot({ path: path.join(output, 'starting-dark.png') })
  for (const width of [760, 480]) {
    await page.setViewportSize({ width, height: 780 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: path.join(output, `starting-${width}.png`) })
  }
  await page.evaluate(() => window.fixture.set({ state: 'failed', error: '本地服务启动超时，请重试。' }))
  await expect(page.getByRole('alert')).toContainText('本地服务启动超时')
  await page.getByRole('button', { name: '启动 / 重试', exact: true }).click()
  await expect(page.locator('.setup-output')).toHaveCount(0)
  await page.evaluate(() => window.fixture.advance('index', '正在恢复索引任务…'))
  await expect(page.locator('[aria-current=step]')).toContainText('恢复索引')
  await page.evaluate(() => window.fixture.advance('connect', '正在将检索工具连接到 Moss…'))
  await expect(page.locator('[aria-current=step]')).toContainText('连接 Moss')
  await page.evaluate(() => window.fixture.set({ state: 'ready', error: null, reindex: { active: false } }))
  await expect(page.getByRole('button', { name: '导入文件', exact: true })).toBeEnabled()
  await expect(page.locator('.document')).toHaveCount(1)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '检索引擎', exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
  const calls = await page.evaluate(() => window.fixture.calls)
  assert.ok(calls.includes('engine.prepare') && calls.includes('engine.cancel') && calls.filter(name => name === 'engine.start').length === 2)
  await fs.writeFile(path.join(output, 'ui-verification.json'), JSON.stringify({ status: 'passed', checks: ['prepare/cancel/start/retry', 'live progress events', 'real byte display and indeterminate stages', 'elapsed/stall/diagnostics', 'failure/ready transitions', 'appearance events + grid theme', '1160/760/480 widths'], errors }, null, 2))
  console.log(`Preparation UI verified: ${output}`)
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
