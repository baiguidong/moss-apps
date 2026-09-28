import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEmbeddedShell } from './build-embedded-shell.mjs'
const root = fileURLToPath(new URL('..', import.meta.url)), repo = resolve(root, '../..'), core = process.env.MOSS_CORE_ROOT
if (!core) throw new Error('Set MOSS_CORE_ROOT to a complete Core checkout with Electron/UI dependencies installed.')
const manifest = JSON.parse(await readFile(join(root, 'app.moss.json'), 'utf8'))
const report = join(repo, 'artifacts/moss.devtools/verification', manifest.version)
await mkdir(report, { recursive: true })
const shell = await buildEmbeddedShell(core, join(report, 'embedded-shell'))
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
const executable = process.env.MOSS_TEST_ELECTRON || join(core, 'ui/node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron')
const desktop = await electron.launch({ executablePath: executable, args: [join(root, 'scripts/desktop-fixture.cjs')], env: { ...process.env, MOSS_DEVTOOLS_SHELL: shell, MOSS_DEVTOOLS_ARCHIVE: join(repo, 'artifacts/moss.devtools', manifest.version, `moss.devtools-${manifest.version}.zip`) }, timeout: 60000 })
const checks = [], errors = []
let directory
try {
  const shellPage = await desktop.firstWindow({ timeout: 60000 })
  await expect(shellPage.locator('webview')).toBeVisible({ timeout: 30000 })
  const isApp = page => page.url().includes('/dist/ui/index.html')
  const page = desktop.context().pages().find(isApp) || await desktop.context().waitForEvent('page', { predicate: isApp, timeout: 30000 })
  directory = await desktop.evaluate(() => globalThis.devtoolsFixture.directory)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') console.error('App console:', message.text()) })
  await expect(page.getByText('就绪 · 按需运行')).toBeVisible()
  await page.bringToFront()
  await desktop.evaluate(() => globalThis.devtoolsFixture.focus())
  const screenshot = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await writeFile(join(report, name), Buffer.from(await desktop.evaluate(() => globalThis.devtoolsFixture.screenshot()), 'base64'))
  }
  const passed = message => { checks.push(message); console.log(`PASS ${message}`) }
  const click = async locator => {
    await expect(locator).toBeVisible(); await expect(locator).toBeEnabled()
    const href = await locator.getAttribute('href'), box = await locator.boundingBox()
    assert.ok(box)
    await desktop.evaluate((_electron, point) => globalThis.devtoolsFixture.click(point), { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) })
    if (href?.startsWith('#')) await page.waitForURL(url => url.hash === href)
  }
  // Electron webview targets do not route CDP Input.insertText reliably. Use the
  // guest's native input API (which emits real input events) after focusing it.
  const enter = async (label, text) => {
    await page.getByRole('textbox', { name: label, exact: true }).focus()
    await desktop.evaluate((_electron, text) => globalThis.devtoolsFixture.insertText(text), text)
  }
  await enter('时间戳', '1704067200123')
  await expect(page.getByRole('textbox', { name: '时间戳', exact: true })).toHaveValue('1704067200123')
  await click(page.getByRole('button', { name: '转换', exact: true }))
  await expect(page.getByText('2024-01-01 08:00:00.123 (UTC+08:00)', { exact: true })).toBeVisible()
  await expect(page.getByText('本地服务运行中')).toBeVisible()
  await screenshot('timestamp-light.png')
  passed('ZIP installation, real preload, on-demand Node Backend and timestamp conversion')
  await click(page.getByRole('link', { name: 'Base64', exact: true }))
  await click(page.getByRole('button', { name: '填入示例' }))
  await click(page.getByRole('button', { name: '编码为 Base64' }))
  await expect(page.getByRole('textbox', { name: '转换结果' })).toHaveValue(Buffer.from('你好，Moss 👋').toString('base64'))
  await click(page.getByRole('button', { name: '结果用作输入' }))
  await click(page.getByRole('button', { name: '解码为文本' }))
  await expect(page.getByRole('textbox', { name: '转换结果' })).toHaveValue('你好，Moss 👋')
  passed('Base64 Unicode roundtrip through real Backend')
  await click(page.getByRole('link', { name: 'JSON', exact: true }))
  await click(page.getByRole('button', { name: '填入示例' }))
  await click(page.getByRole('button', { name: '格式化', exact: true }))
  await expect(page.getByRole('textbox', { name: 'JSON 结果' })).toHaveValue(/9007199254740993/)
  await screenshot('json-light.png')
  passed('JSON formatting preserves large integers in the installed App')
  await click(page.getByRole('link', { name: 'AES', exact: true }))
  await click(page.getByRole('button', { name: '生成密钥' }))
  await enter('待加密文本', 'Moss desktop AES 👋')
  await click(page.getByRole('button', { name: '加密文本' }))
  await expect(page.getByRole('textbox', { name: '加密结果' })).not.toHaveValue('')
  await click(page.getByRole('button', { name: '用此结果解密' }))
  await click(page.getByRole('button', { name: '解密文本' }))
  await expect(page.getByRole('textbox', { name: '解密结果' })).toHaveValue('Moss desktop AES 👋')
  passed('AES key generation, native GCM and decryption in packaged UI and Backend')
  await desktop.evaluate(() => globalThis.devtoolsFixture.theme({ themeMode: 'dark', cssThemeId: 'dot-theme' }))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-background-style', 'dot-theme')
  await screenshot('aes-dark.png')
  const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, bottom: document.querySelector('.app-footer').getBoundingClientRect().bottom, height: innerHeight }))
  assert.ok(geometry.scroll <= geometry.width && geometry.bottom <= geometry.height + 1)
  passed('Moss appearance events update the installed UI without reload; embedded layout fits')
  const tools = await desktop.evaluate(() => globalThis.devtoolsFixture.tools())
  assert.equal(tools.tools.length, 4)
  const result = await desktop.evaluate(() => globalThis.devtoolsFixture.invokeTool('json.process', { operation: 'minify', input: '{ "id": 9007199254740993 }', indent: '2' }))
  assert.equal(result.text, '{"id":9007199254740993}')
  passed('Four AI tool contributions register; actual contribution invocation returns precise JSON')
  assert.ok(await desktop.evaluate(() => globalThis.devtoolsFixture.calls()) >= 6)
  await desktop.evaluate(() => globalThis.devtoolsFixture.enabled(false))
  await expect(page.getByText('应用已停用，请在 Moss 中启用')).toBeVisible()
  await click(page.getByRole('button', { name: '解密文本' }))
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '解密结果' })).toHaveValue('')
  await desktop.evaluate(() => globalThis.devtoolsFixture.enabled(true))
  await click(page.getByRole('button', { name: '解密文本' }))
  await expect(page.getByRole('textbox', { name: '解密结果' })).toHaveValue('Moss desktop AES 👋')
  passed('Disable/re-enable uses real runtime, errors remain visible and no local fallback runs')
  assert.deepEqual(errors, [])
  await writeFile(join(report, 'report.json'), JSON.stringify({ appId: manifest.id, version: manifest.version, platform: `${process.platform}-${process.arch}`, checks, pageErrors: errors }, null, 2) + '\n')
} finally {
  await desktop.evaluate(() => globalThis.devtoolsFixture?.cleanup()).catch(() => {})
  await desktop.close()
  if (directory) await rm(directory, { recursive: true, force: true })
}
