import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import manifest from '../app.moss.json' with { type: 'json' }
import { SERVICE, DEFAULT_SETTINGS, type Catalog, type Input, type Method } from '../src/contracts'
const screenshots = path.resolve(import.meta.dirname, '../../..', `artifacts/${manifest.id}/screenshots/${manifest.version}`)
async function fixture(page: Page, state: 'empty' | 'ready' | 'failed' = 'empty') {
  const catalog: Catalog = { settings: { ...DEFAULT_SETTINGS, directories: state === 'empty' ? [] : ['/demo/Work Folder'] }, preparation: { state: state === 'empty' ? 'ready' : state, ...(state === 'failed' ? { error: '连接失败，请检查目录或程序路径。' } : {}) }, servers: [] }
  const calls: Method[] = []
  let polling = 0, rejectReconnect = false
  const sync = () => { catalog.servers = [{ name: SERVICE, enabled: true, updatedAt: 1, credentialsMissing: false, config: { type: 'stdio', disabledTools: catalog.settings.disabledTools }, check: { state: 'connected', checkedAt: 1, tools: [{ name: 'write_file', description: '测试工具', disabled: catalog.settings.disabledTools.includes('write_file') }] } }] }
  sync()
  await page.exposeFunction('serviceInvoke', async (method: Method, input: Input) => {
    calls.push(method)
    if (method === 'servers.save') {
      if (input.directories?.includes('/missing')) return { ok: false, error: { message: '目录不存在或不可访问。' } }
      catalog.settings = { ...catalog.settings, ...structuredClone(input) }; sync()
    }
    if (method === 'servers.inspect' && rejectReconnect) { rejectReconnect = false; return { ok: false, error: { message: '服务检查失败，请重试。' } } }
    if (method !== 'servers.list') { catalog.preparation = { state: 'connecting' }; polling = 2 }
    else if (polling && --polling === 0) catalog.preparation = { state: 'ready' }
    return { ok: true, data: structuredClone(catalog) }
  })
  await page.addInitScript(() => {
    window.mossApp = {
      app: { getInfo: async () => ({ appearance: { themeMode: 'system', cssThemeId: 'default' } }), getStatus: async () => ({ state: 'running' }), getInstallationState: async () => ({ installation: { enabled: true } }) },
      actions: { invoke: async (name: string, input: unknown) => ({ ok: true, result: await (window as any).serviceInvoke(name, input) }), cancel: async () => {} },
      events: { on: () => () => {} },
    } as any
  })
  return { catalog, calls, rejectNextReconnect: () => { rejectReconnect = true } }
}

test('first-use settings, validation, exclusions and clearing the scope', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('服务可用')
  await expect(page.getByRole('button', { name: '检查服务' })).toBeEnabled()
  await page.getByRole('button', { name: '添加公共目录' }).click()
  const dialog = page.getByRole('dialog', { name: '文件系统设置' })
  await dialog.getByLabel('公共目录（可选）').fill('/missing')
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog.getByRole('alert')).toContainText('目录不存在')
  await dialog.getByLabel('公共目录（可选）').fill('/demo/Work Folder')

  await dialog.getByLabel('不启用的工具').fill('write_file')
  await dialog.getByRole('button', { name: '保存设置' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('服务可用')
  expect(f.catalog.settings.directories).toEqual(['/demo/Work Folder'])

  await page.locator('.service-tools summary').click()
  await expect(page.getByRole('heading', { name: 'write_file已排除' })).toBeVisible()
  await page.getByLabel('搜索工具').fill('no-such-tool')
  await expect(page.getByText('没有匹配的工具。')).toBeVisible()
  await page.getByRole('button', { name: '文件系统设置' }).click()
  await page.getByLabel('公共目录（可选）').fill('')
  await page.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByRole('status')).toContainText('服务可用')
  await expect(page.getByText('默认使用当前会话工作目录', { exact: true })).toBeVisible()
})

test('failed startup remains configurable and retry recovers', async ({ page }) => {
  const f = await fixture(page, 'failed')
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('连接失败')
  await expect(page.getByRole('button', { name: '文件系统设置' })).toBeEnabled()
  f.rejectNextReconnect()
  await page.getByRole('button', { name: '检查服务' }).click()
  await expect(page.getByRole('alert')).toContainText('服务检查失败')
  await page.getByRole('button', { name: '检查服务' }).click()
  await expect(page.getByRole('status')).toContainText('服务可用')
})

for (const theme of ['light', 'dark'] as const) test(`${theme} layout and settings fit narrow windows`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await fixture(page, 'ready'); await page.emulateMedia({ colorScheme: theme }); await page.goto('/')
  await expect(page.getByRole('status')).toContainText('服务可用')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: path.join(screenshots, `${theme}.png`), fullPage: true })
  await page.getByRole('button', { name: '文件系统设置' }).click()
  await page.screenshot({ path: path.join(screenshots, `${theme}-settings.png`), fullPage: true })
  await page.keyboard.press('Escape')
  for (const width of [600, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '检查服务' })).toBeInViewport()
  }
  await page.screenshot({ path: path.join(screenshots, `${theme}-narrow.png`), fullPage: true })
  expect(errors).toEqual([])
})

test('ordinary browser displays explicit demo mode', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('演示模式', { exact: false })).toBeVisible()
  await expect(page.getByRole('heading', { name: '文件系统', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('服务可用')
})
