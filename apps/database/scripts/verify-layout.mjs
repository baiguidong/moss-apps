// Exercise the built UI in short embedded panels. No database is connected.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const option = name => process.argv[process.argv.indexOf(name) + 1]
const uiRoot = path.resolve(process.argv.includes('--ui') ? option('--ui') : path.join(appRoot, 'dist/ui'))
const output = path.resolve(process.argv.includes('--output') ? option('--output') : path.join(appRoot, 'test-results/layout'))
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true })
const results = [], errors = []
try {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    const file = path.resolve(uiRoot, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)))
    if (url.hostname !== 'localhost' || !file.startsWith(uiRoot + path.sep)) return route.abort()
    const body = await fs.readFile(file).catch(() => null)
    if (!body) return route.fulfill({ status: 404, body: '' })
    await route.fulfill({ body, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await page.addInitScript(() => {
    window.mossApp = {
      app: { getInfo: async () => ({ appearance: { themeMode: 'system', cssThemeId: 'default' } }) },
      actions: { invoke: async action => ({ ok: true, result: action === 'connections.list'
        ? { ok: true, data: { connections: [] } }
        : { ok: false, error: '无法连接到数据库，请检查连接信息。' } }), cancel: async () => {} },
      events: { on: () => () => {} },
    }
  })
  for (const theme of ['dark', 'light']) for (const [width, height] of [[1080, 820], [900, 560], [560, 440], [390, 568], [320, 480]]) {
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize({ width, height })
    await page.goto('http://localhost/')
    await page.getByRole('button', { name: '添加连接', exact: true }).click()
    await page.getByLabel('连接名称').fill('业务数据库')
    await page.getByLabel('数据库名称', { exact: true }).fill('orders')
    await page.getByLabel('用户名', { exact: true }).fill('reader')
    await page.getByLabel('查询超时（秒）', { exact: true }).scrollIntoViewIfNeeded()
    const measurement = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]'), footer = dialog.querySelector('footer')
      const inputs = [...dialog.querySelectorAll('input[type=number]')].slice(-2)
      const controls = [...inputs, ...footer.querySelectorAll('button')]
      const unobscured = controls.every(el => {
        const rect = el.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return rect.top >= 0 && rect.bottom <= innerHeight && (hit === el || el.contains(hit))
      })
      return { footerTop: footer.getBoundingClientRect().top, footerBottom: footer.getBoundingClientRect().bottom,
        inputsBottom: Math.max(...inputs.map(el => el.getBoundingClientRect().bottom)), unobscured,
        horizontalOverflow: dialog.scrollWidth > dialog.clientWidth }
    })
    const label = `${theme}-${width}x${height}`
    await page.screenshot({ path: path.join(output, `${label}.png`) })
    assert(measurement.inputsBottom <= measurement.footerTop, `${label}: footer overlaps input fields: ${JSON.stringify(measurement)}`)
    assert(measurement.unobscured, `${label}: controls are clipped or covered`)
    assert(!measurement.horizontalOverflow, `${label}: horizontal overflow`)
    // Validation feedback must also remain reachable without moving the actions.
    const button = page.getByRole('button', { name: '保存并测试', exact: true })
    const before = await button.boundingBox()
    await button.click()
    await page.getByRole('alert').waitFor()
    const after = await button.boundingBox()
    assert(after.y + after.height <= height, `${label}: feedback moved the action out of view`)
    if (height <= 568) assert(Math.abs(before.y - after.y) <= 1, `${label}: action bar moved with validation feedback`)
    await page.getByRole('alert').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, `${label}-feedback.png`) })
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    results.push({ theme, width, height, ...measurement })
  }
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, results, errors }, null, 2))
  console.log(`PASS ${results.length} editor layouts: inputs, footer, feedback and keyboard dismissal`)
} finally { await browser.close() }
