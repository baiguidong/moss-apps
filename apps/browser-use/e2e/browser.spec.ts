import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import manifest from '../app.moss.json' with { type: 'json' }
import { DEFAULT_CONFIG, PLAYWRIGHT_CDP } from '../src/browser-config'
import type { Catalog, Input, Method } from '../src/contracts'

const screenshots = path.resolve(import.meta.dirname, '../../..', `artifacts/moss.browser-use/screenshots/${manifest.version}`)
async function fixture(page: Page, failed = false) {
  const calls: Method[] = []
  const catalog: Catalog = { preparation: failed ? { state: 'failed', error: '未找到 Playwright 扩展。请在日常 Chrome 中安装扩展。' } : { state: 'ready' }, servers: [{
    name: PLAYWRIGHT_CDP, enabled: true, credentialsMissing: false, updatedAt: 1, config: structuredClone(DEFAULT_CONFIG),
    check: { state: failed ? 'failed' : 'connected', checkedAt: 1, tools: [{ name: 'browser_click', description: '点击网页元素', disabled: false }] },
  }] }
  let polling = 0, rejectReconnect = false
  await page.exposeFunction('browserInvoke', async (method: Method, input: Input) => {
    calls.push(method)
    if (method === 'servers.inspect' && rejectReconnect) {
      rejectReconnect = false
      return { ok: false, error: { message: '重连请求失败，请重试。' } }
    }
    if (method === 'servers.save') {
      catalog.servers[0].config = structuredClone(input.config!)
      catalog.servers[0].updatedAt++
    }
    if (method !== 'servers.list') { catalog.preparation = { state: 'connecting' }; polling = 2 }
    else if (polling && --polling === 0) {
      catalog.preparation = { state: 'ready' }
      catalog.servers[0].check!.state = 'connected'
      catalog.servers[0].check!.checkedAt = Date.now()
      catalog.servers[0].check!.tools[0].disabled = catalog.servers[0].config.disabledTools?.includes('browser_click') || false
    }
    return { ok: true, data: structuredClone(catalog) }
  })
  await page.addInitScript(() => {
    window.mossApp = {
      app: { getInfo: async () => ({ appearance: { themeMode: 'system', cssThemeId: 'default' } }), getStatus: async () => ({ state: 'running' }), getInstallationState: async () => ({ installation: { enabled: true } }) },
      actions: { invoke: async (name: string, input: unknown) => ({ ok: true, result: await (window as any).browserInvoke(name, input) }), cancel: async () => {} },
      events: { on: () => () => {} },
    } as any
  })
  return { calls, catalog, rejectNextReconnect: () => { rejectReconnect = true } }
}

test('shows one browser, saves structured settings and refreshes excluded tools', async ({ page }) => {
  const host = await fixture(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('工具已就绪')
  await expect(page.getByRole('button', { name: '添加服务' })).toHaveCount(0)
  await expect(page.getByRole('switch')).toHaveCount(0)
  await page.getByRole('button', { name: '连接设置' }).click()
  const dialog = page.getByRole('dialog', { name: '浏览器连接设置' })
  await expect(dialog.getByLabel('连接方式')).toHaveValue('managed')
  await expect(dialog.getByLabel('CDP 地址')).not.toBeVisible()
  await dialog.getByLabel('连接方式').selectOption('extension')
  await expect(dialog.getByRole('link', { name: '安装 Playwright 扩展' })).toHaveAttribute('href', /chromewebstore\.google\.com/)
  await dialog.getByLabel('连接方式').selectOption('cdp')
  await dialog.getByLabel('CDP 地址').fill('invalid')
  await dialog.getByRole('button', { name: '保存并连接' }).click()
  await expect(dialog.getByRole('alert')).toContainText('有效的 CDP')
  await dialog.getByLabel('CDP 地址').fill('http://127.0.0.1:9444')
  await dialog.locator('summary').click()
  await dialog.getByLabel('不启用的工具').fill('browser_click')
  await dialog.getByRole('button', { name: '保存并连接' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('工具已就绪')
  expect(host.catalog.servers[0].config.args).toContain('http://127.0.0.1:9444')
  expect(host.catalog.servers[0].config.args).not.toContain('--extension')
  expect(host.calls.filter(name => name === 'servers.save')).toHaveLength(1)
  await page.locator('.browser-tools summary').click()
  await expect(page.getByRole('heading', { name: 'browser_click已排除' })).toBeVisible()
  expect(errors).toEqual([])
})

test('startup failure exposes configuration and retry while polling is bounded to preparation', async ({ page }) => {
  const host = await fixture(page, true)
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('未找到 Playwright 扩展')
  await expect(page.getByRole('button', { name: '连接设置' })).toBeEnabled()
  host.rejectNextReconnect()
  await page.getByRole('button', { name: '重新连接' }).click()
  await expect(page.getByRole('alert')).toContainText('重连请求失败')
  await expect(page.getByRole('button', { name: '重新连接' })).toBeEnabled()
  await expect(page.getByRole('alert')).toContainText('重连请求失败')
  await page.getByRole('button', { name: '重新连接' }).click()
  await expect(page.getByRole('status')).toContainText('正在连接')
  await expect(page.getByRole('status')).toContainText('工具已就绪')
  expect(host.calls.filter(name => name === 'servers.inspect')).toHaveLength(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('saving daily Chrome settings preserves extension attachment and supports an existing profile', async ({ page }) => {
  const host = await fixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: '连接设置' }).click()
  const dialog = page.getByRole('dialog', { name: '浏览器连接设置' })
  await dialog.getByLabel('连接方式').selectOption('extension')
  await dialog.locator('summary').click()
  await dialog.getByLabel('Chrome 用户配置').fill('Profile 1')
  await dialog.getByRole('button', { name: '保存并连接' }).click()
  await expect(dialog).toHaveCount(0)
  const args = host.catalog.servers[0].config.args
  expect(args).toContain('--extension')
  expect(args).toContain('Profile 1')
  expect(args).not.toContain('--cdp-endpoint')
  expect(args).not.toContain('--user-data-dir')
})

for (const theme of ['light', 'dark'] as const) test(`${theme} page and settings fit narrow windows`, async ({ page }) => {
  await fixture(page)
  await page.emulateMedia({ colorScheme: theme })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('工具已就绪')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: path.join(screenshots, `${theme}.png`), fullPage: true })
  await page.getByRole('button', { name: '连接设置' }).click()
  await page.screenshot({ path: path.join(screenshots, `${theme}-settings.png`), fullPage: true })
  await page.keyboard.press('Escape')
  for (const width of [600, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '重新连接' })).toBeInViewport()
  }
  await page.screenshot({ path: path.join(screenshots, `${theme}-narrow.png`), fullPage: true })
})
