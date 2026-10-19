// Exercise the actual templates returned to AI authors, with an isolated Host bridge.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createBuilderActions } from '../apps/app-builder/src/backend/actions.mjs'
import { assertAppContentLayout, assertAppWorkspaceLayout } from './app-layout-check.mjs'

const repo = fileURLToPath(new URL('..', import.meta.url)), core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const require = createRequire(path.join(repo, 'apps/image-tools/package.json')), requireCore = createRequire(path.join(core, 'ui/package.json'))
const { chromium, expect } = require('@playwright/test'), { build } = requireCore('esbuild')
const output = path.join(repo, 'artifacts/app-layout/compact'), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-layout-'))
await fs.mkdir(output, { recursive: true })
let browser, server
try {
  const actions = createBuilderActions(async () => { throw new Error('Layout guidance should not invoke a Host operation') })
  const { templates, guidance } = await actions.builder_inspect({ operation: 'guidance' })
  assert.match(guidance, /ui-layout\.md/)
  for (const name of ['index.html', 'ui.css', 'theme.css', 'ui.mjs']) await fs.writeFile(path.join(temp, name), templates[name])
  await build({ entryPoints: [path.join(temp, 'ui.mjs')], bundle: true, format: 'esm', outfile: path.join(temp, 'main.js'), alias: { '@moss/app-sdk/ui': path.join(repo, 'vendor/moss-core/packages/app-sdk/src/ui/index.mjs') } })
  await fs.writeFile(path.join(temp, 'index.html'), templates['index.html'].replace('./ui.mjs', './main.js'))
  server = http.createServer(async (req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1)
    if (!['index.html', 'main.js', 'ui.css', 'theme.css'].includes(name)) { res.writeHead(404); res.end(); return }
    try { res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(await fs.readFile(path.join(temp, name))) }
    catch { res.writeHead(500); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ channel: process.env.MOSS_TEST_BROWSER_CHANNEL || 'chrome', headless: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    let appearance = { themeMode: 'system', cssThemeId: 'default' }
    const listeners = new Set()
    window.mossApp = { app: { getInfo: async () => ({ displayName: '示例应用', appearance }) }, events: { on: (name, listener) => { if (name === 'appearance') listeners.add(listener); return () => listeners.delete(listener) } } }
    window.setFixtureAppearance = mode => { appearance = { ...appearance, themeMode: mode }; for (const listener of listeners) listener() }
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  for (const [name, width, height] of [['normal', 1200, 800], ['narrow', 720, 600], ['small', 360, 640]]) {
    await page.setViewportSize({ width, height })
    await assertAppContentLayout(page, { displayName: '示例应用' })
    await assertAppWorkspaceLayout(page)
    await expect(page.locator('#input')).toBeInViewport()
    await expect(page.locator('#result-title')).toBeInViewport()
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => window.setFixtureAppearance(theme), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.screenshot({ path: path.join(output, `template-${name}-${theme}.png`), fullPage: true })
    }
  }
  await page.locator('#open-settings').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.locator('#open-settings')).toBeFocused()
  await page.evaluate(() => window.setFixtureAppearance('system'))
  await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.setViewportSize({ width: 720, height: 600 })
  await page.locator('#result').evaluate(element => { element.textContent = '长文件名和结果内容'.repeat(200) })
  await assertAppWorkspaceLayout(page)
  assert.deepEqual(errors, [])

  // Check the safeguards against actual layout failures, not text snapshots.
  const negative = await browser.newPage({ viewport: { width: 720, height: 600 } })
  await negative.setContent('<div data-app-toolbar><button data-app-secondary-action>设置</button></div><main data-app-primary>数据</main>')
  await assert.rejects(() => assertAppWorkspaceLayout(negative), /Secondary settings/)
  await negative.setContent('<div data-app-toolbar>数据列表<button data-app-secondary-action>设置</button></div><main data-app-primary>数据</main>')
  await assertAppWorkspaceLayout(negative)
  await negative.setContent('<header style="height:180px">占位头部</header><main data-app-primary>数据</main>')
  await assert.rejects(() => assertAppWorkspaceLayout(negative), /Primary content starts/)
  await negative.setContent('<main data-app-primary style="width:2000px">超宽表格</main>')
  await assert.rejects(() => assertAppWorkspaceLayout(negative), /overflows/)
  await fs.writeFile(path.join(output, 'template.json'), JSON.stringify({ passed: true, checks: ['real Builder template delivery', 'three viewport sizes in light/dark', 'primary input and result visible', 'settings dialog and focus return', 'live/system appearance', 'long result wrapping', 'orphan toolbar / oversized header / overflow detection'], checkedAt: new Date().toISOString() }, null, 2) + '\n')
  console.log('PASS Builder layout: responsive work area, appearance, settings, focus, long content and layout safeguards')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await fs.rm(temp, { recursive: true, force: true })
}
