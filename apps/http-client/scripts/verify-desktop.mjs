import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEmbeddedShell } from './build-embedded-shell.mjs'
import { createTestServer } from '../tests/fixtures.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)), repo = resolve(root, '../..'), core = process.env.MOSS_CORE_ROOT
if (!core) throw new Error('Set MOSS_CORE_ROOT to a complete Core checkout with Electron/UI dependencies installed.')
const manifest = JSON.parse(await readFile(join(root, 'app.moss.json'), 'utf8'))
const report = join(repo, 'artifacts/moss.http-client/verification', manifest.version)
await mkdir(report, { recursive: true })
const shell = await buildEmbeddedShell(core, join(report, 'embedded-shell'))
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
const executable = process.env.MOSS_TEST_ELECTRON || join(core, 'ui/node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron')
const desktop = await electron.launch({ executablePath: executable, args: [join(root, 'scripts/desktop-fixture.cjs')], env: { ...process.env, MOSS_HTTP_SHELL: shell, MOSS_HTTP_ARCHIVE: process.env.MOSS_HTTP_ARCHIVE || join(repo, 'artifacts/moss.http-client', manifest.version, `moss.http-client-${manifest.version}.zip`) }, timeout: 60000 })
const server = await createTestServer(), checks = [], errors = []
let directory, appPage
try {
  const shellPage = await desktop.firstWindow({ timeout: 60000 })
  await expect(shellPage.locator('webview')).toBeVisible({ timeout: 30000 })
  const isApp = page => page.url().includes('/dist/ui/index.html')
  const page = desktop.context().pages().find(isApp) || await desktop.context().waitForEvent('page', { predicate: isApp, timeout: 30000 })
  appPage = page
  directory = await desktop.evaluate(() => globalThis.httpFixture.directory)
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByText('就绪 · 按需运行')).toBeVisible()
  await page.bringToFront(); await desktop.evaluate(() => globalThis.httpFixture.focus())
  const screenshot = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await writeFile(join(report, name), Buffer.from(await desktop.evaluate(() => globalThis.httpFixture.screenshot()), 'base64'))
  }
  const passed = message => { checks.push(message); console.log(`PASS ${message}`) }
  const click = async locator => {
    await expect(locator).toBeVisible(); await expect(locator).toBeEnabled(); await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox(); assert.ok(box)
    await desktop.evaluate((_electron, point) => globalThis.httpFixture.click(point), { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) })
  }
  const enter = async (label, text) => {
    const input = page.getByRole('textbox', { name: label, exact: true })
    await input.focus(); await input.evaluate(el => el.select())
    await desktop.evaluate((_electron, text) => globalThis.httpFixture.insertText(text), text)
    await expect(input).toHaveValue(text)
  }
  const send = () => click(page.getByRole('button', { name: '发送请求', exact: true }))
  await enter('请求地址', `${server.url}/echo`)
  await enter('参数名称 1', 'hello'); await enter('参数值 1', '你好 & +')
  await send()
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveValue(/你好/)
  assert.deepEqual(JSON.parse(await page.getByRole('textbox', { name: '响应正文' }).inputValue()).query, [['hello', '你好 & +']])
  await expect(page.getByText('本地服务运行中')).toBeVisible()
  await screenshot('http-light.png')
  passed('ZIP install, real Core preload/runtime, Node Backend and Unicode query request')
  await page.getByLabel('请求方法').selectOption('POST')
  await click(page.locator('.request-tabs').getByRole('button', { name: '正文', exact: true }))
  await page.getByLabel('正文类型').selectOption('json')
  await enter('请求正文', '{"id":9007199254740993,"message":"你好"}')
  await click(page.getByRole('button', { name: '鉴权', exact: true }))
  await page.getByLabel('鉴权方式').selectOption('bearer')
  const token = page.getByLabel('Bearer Token')
  await token.focus(); await desktop.evaluate(() => globalThis.httpFixture.insertText('desktop-test-secret'))
  await send()
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveValue(/9007199254740993/)
  assert.equal(server.requests.at(-1).headers.authorization, 'Bearer desktop-test-secret')
  assert.equal(server.requests.at(-1).body, '{"id":9007199254740993,"message":"你好"}')
  passed('POST JSON preserves numeric literals and Bearer auth reaches the real local target')
  await click(page.getByRole('button', { name: '保存模板', exact: true }))
  await enter('模板名称', '本地接口')
  await click(page.getByRole('button', { name: '确认保存' }))
  await expect(page.getByRole('status')).toContainText('模板已保存')
  const storage = await desktop.evaluate(() => globalThis.httpFixture.storage())
  assert.ok(!storage.includes('desktop-test-secret') && !storage.includes('9007199254740993') && !storage.includes('你好'))
  // Reload through WebContents: CDP Page.reload does not reliably target webviews.
  await desktop.evaluate(() => globalThis.httpFixture.reload())
  await click(page.getByRole('button', { name: 'POST 本地接口', exact: true }))
  await expect(page.getByRole('textbox', { name: '请求地址' })).toHaveValue(`${server.url}/echo`)
  await expect(page.getByRole('textbox', { name: '参数值 1' })).toHaveValue('')
  passed('Public storage persists templates via Core snapshot helpers, without parameter values, body or credentials')
  await page.getByLabel('请求方法').selectOption('GET')
  await enter('请求地址', `${server.url}/slow`)
  await send()
  await expect.poll(() => server.requests.filter(item => item.url.startsWith('/slow')).length).toBe(1)
  await click(page.getByRole('button', { name: '取消请求', exact: true }))
  await expect(page.getByRole('alert')).toContainText('请求已取消')
  await expect.poll(() => server.closedSlowRequests()).toBe(1)
  passed('Real action cancellation reaches Node and closes the target connection')
  await enter('请求地址', `${server.url}/bigint`)
  await send()
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveValue(/9007199254740993/)
  await desktop.evaluate(() => globalThis.httpFixture.theme({ themeMode: 'dark', cssThemeId: 'dot-theme' }))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-background-style', 'dot-theme')
  await screenshot('http-dark.png')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  passed('Installed UI follows Moss appearance events and fits its real embedded container')
  const contributions = await desktop.evaluate(() => globalThis.httpFixture.tools())
  assert.equal(contributions.tools.length, 0)
  await assert.rejects(desktop.evaluate((_electron, url) => globalThis.httpFixture.invokeTool('request.send', { url }), `${server.url}/bigint`), /unavailable/)
  passed('HTTP UI requests remain available without registering an AI tool; Agent contribution invocation is rejected')
  await desktop.evaluate(() => globalThis.httpFixture.enabled(false))
  await expect(page.getByText('应用已停用，请在 Moss 中启用')).toBeVisible()
  await send()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveCount(0)
  await desktop.evaluate(() => globalThis.httpFixture.enabled(true))
  await send()
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveValue(/9007199254740993/)
  passed('Disable/re-enable uses Core runtime state; errors stay visible with no browser request fallback')
  assert.ok(await desktop.evaluate(() => globalThis.httpFixture.calls()) >= 6)
  assert.deepEqual(errors, [])
  await writeFile(join(report, 'report.json'), JSON.stringify({ appId: manifest.id, version: manifest.version, platform: `${process.platform}-${process.arch}`, checks, pageErrors: errors }, null, 2) + '\n')
} catch (error) {
  console.error('Integration failure:', error)
  if (appPage) {
    console.error('Storage error:', await desktop.evaluate(() => globalThis.httpFixture.storageError()))
    console.error('Visible errors:', await appPage.getByRole('alert').allTextContents().catch(() => 'page closed'))
    console.error('Save dialog:', await appPage.getByRole('form', { name: '保存请求模板' }).allTextContents().catch(() => 'closed'))
    await writeFile(join(report, 'failure.png'), Buffer.from(await desktop.evaluate(() => globalThis.httpFixture.screenshot()), 'base64')).catch(() => {})
  }
  throw error
} finally {
  await server.close()
  await desktop.evaluate(() => globalThis.httpFixture?.cleanup()).catch(() => {})
  await desktop.close()
  if (directory) await rm(directory, { recursive: true, force: true })
}
