import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
const bridge = 'http://127.0.0.1:4181'
let target: string
test.beforeAll(async ({ request }) => { target = (await (await request.get(`${bridge}/info`)).json()).target })
async function setup(page: Page) {
  await page.addInitScript(({ bridge }) => {
    const callbacks = new Map<string, (data: unknown) => void>()
    const rpc = async (route: string, value: unknown) => (await fetch(`${bridge}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })).json()
    const api: any = {
      appearance: { themeMode: 'light', cssThemeId: 'grid-theme' }, fail: false,
      app: { getInfo: async () => ({ appearance: api.appearance }), getInstallationState: async () => ({ enabled: true }) },
      instances: { list: async () => [{ id: 'default' }], getStatus: async () => ({ state: api.fail ? 'error' : 'running' }) },
      events: { on: (name: string, callback: (data: unknown) => void) => { callbacks.set(name, callback); return () => callbacks.delete(name) } },
      actions: {
        invoke: async (_instance: string, _name: string, input: unknown, options: { requestId: string }) => {
          if (api.fail) throw new Error('Backend unavailable')
          const response = await rpc('invoke', { id: options.requestId, input })
          if (response.error) throw new Error(response.error)
          return response.result
        },
        cancel: async (_instance: string, id: string) => rpc('cancel', { id }),
      },
      storage: { getItem: async (key: string) => JSON.parse(sessionStorage.getItem(key) || 'null'), setItem: async (key: string, value: unknown) => { sessionStorage.setItem(key, JSON.stringify(value)); return { ok: true, key } } },
      update: (themeMode: string, cssThemeId: string) => { api.appearance = { themeMode, cssThemeId }; callbacks.get('appearance')?.({}); callbacks.get('runtime')?.({}) },
    }
    window.mossApp = api
  }, { bridge })
  page.on('dialog', dialog => void dialog.accept())
  await page.goto('/')
}
const send = (page: Page) => page.getByRole('button', { name: '发送请求', exact: true }).click()
test('sends actual GET with Unicode duplicate parameters and custom headers', async ({ page }) => {
  await setup(page)
  await page.getByRole('textbox', { name: '请求地址' }).fill(`${target}/echo?first=1`)
  await page.getByRole('textbox', { name: '参数名称 1' }).fill('q')
  await page.getByRole('textbox', { name: '参数值 1' }).fill('你好 & +')
  await page.getByRole('button', { name: '添加参数', exact: true }).click()
  await page.getByRole('textbox', { name: '参数名称 2' }).fill('q')
  await page.getByRole('textbox', { name: '参数值 2' }).fill('two')
  await page.getByRole('button', { name: '请求头', exact: true }).click()
  await page.getByRole('textbox', { name: '请求头名称 1' }).fill('X-Moss')
  await page.getByRole('textbox', { name: '请求头值 1' }).fill('desktop')
  await send(page)
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveValue(/你好/)
  const result = JSON.parse(await page.getByRole('textbox', { name: '响应正文' }).inputValue())
  expect(result.query).toEqual([['first', '1'], ['q', '你好 & +'], ['q', 'two']])
  expect(result.headers['x-moss']).toBe('desktop')
  await page.getByRole('button', { name: /^响应头/ }).click()
  await expect(page.getByText('x-test-response', { exact: true })).toBeVisible()
})
test('POST JSON and Bearer authentication, validation errors and stale response clearing', async ({ page }) => {
  await setup(page)
  await page.getByRole('textbox', { name: '请求地址' }).fill(`${target}/echo`)
  await page.getByLabel('请求方法').selectOption('POST')
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.getByLabel('正文类型').selectOption('json')
  await page.getByRole('textbox', { name: '请求正文' }).fill('{"id":9007199254740993}')
  await page.getByRole('button', { name: '鉴权', exact: true }).click()
  await page.getByLabel('鉴权方式').selectOption('bearer')
  await page.getByLabel('Bearer Token').fill('browser-test-token')
  await send(page)
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveValue(/9007199254740993/)
  expect(JSON.parse(await page.getByRole('textbox', { name: '响应正文' }).inputValue()).headers.authorization).toBe('Bearer browser-test-token')
  await page.locator('.request-tabs').getByRole('button', { name: '正文', exact: true }).click()
  await page.getByRole('textbox', { name: '请求正文' }).fill('{"id":}')
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveCount(0)
  await send(page)
  await expect(page.getByRole('alert')).toContainText('JSON 格式不正确')
})
test('saves only a template structure, reloads it and confirms deletion', async ({ page }) => {
  await setup(page)
  await page.getByRole('textbox', { name: '请求地址' }).fill(`${target}/echo?token=private-url-token`)
  await page.getByRole('textbox', { name: '参数名称 1' }).fill('secret')
  await page.getByRole('textbox', { name: '参数值 1' }).fill('private-value')
  await page.getByRole('button', { name: '保存模板', exact: true }).click()
  await page.getByRole('textbox', { name: '模板名称' }).fill('我的接口')
  await page.getByRole('button', { name: '确认保存' }).click()
  await expect(page.getByRole('status')).toContainText('模板已保存')
  const saved = await page.evaluate(() => sessionStorage.getItem('request-templates-v1'))
  expect(saved).not.toContain('private-url-token'); expect(saved).not.toContain('private-value')
  await page.reload()
  await page.getByRole('button', { name: 'GET 我的接口' }).click()
  await expect(page.getByRole('textbox', { name: '请求地址' })).toHaveValue(`${target}/echo`)
  await expect(page.getByRole('textbox', { name: '参数名称 1' })).toHaveValue('token')
  await expect(page.getByRole('textbox', { name: '参数值 1' })).toHaveValue('')
  await page.getByRole('button', { name: '删除模板 我的接口' }).click()
  await expect(page.getByRole('button', { name: 'GET 我的接口' })).toBeVisible()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByRole('button', { name: 'GET 我的接口' })).toHaveCount(0)
})
test('timeout and cancellation are explicit and stop the actual backend request', async ({ page, request }) => {
  await setup(page)
  const before = (await (await request.get(`${bridge}/inspect`)).json()).closedSlowRequests
  await page.getByRole('textbox', { name: '请求地址' }).fill(`${target}/slow`)
  await page.getByRole('button', { name: '选项', exact: true }).click()
  await page.getByLabel('请求超时').selectOption('1000')
  await send(page)
  await expect(page.getByRole('alert')).toContainText('超过 1 秒')
  await page.getByLabel('请求超时').selectOption('30000')
  await send(page)
  await expect.poll(async () => (await (await request.get(`${bridge}/inspect`)).json()).requests.filter((item: { url: string }) => item.url === '/slow').length).toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: '取消请求', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('请求已取消')
  await expect.poll(async () => (await (await request.get(`${bridge}/inspect`)).json()).closedSlowRequests).toBeGreaterThanOrEqual(before + 2)
  await expect(page.getByRole('button', { name: '发送请求', exact: true })).toBeEnabled()
})
test('response views handle big integers, HTML, binary, empty and bounded large responses', async ({ page }) => {
  await setup(page)
  for (const route of ['bigint', 'html', 'binary', 'empty', 'gzip']) {
    await page.getByRole('textbox', { name: '请求地址' }).fill(`${target}/${route}`)
    await send(page)
    await expect(page.getByRole('button', { name: '发送请求', exact: true })).toBeVisible()
    if (route === 'bigint') await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveValue(/9007199254740993/)
    if (route === 'html') { await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveValue(/<script>/); expect(await page.evaluate(() => (window as any).untrustedExecuted)).toBeUndefined() }
    if (route === 'binary') { await expect(page.getByText('二进制或无法解码的响应，以 Base64 显示。')).toBeVisible(); await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveValue('AP+AKg==') }
    if (route === 'empty') await expect(page.getByText('此响应没有正文。')).toBeVisible()
    if (route === 'gzip') await expect(page.getByText('响应超过 1 MiB，仅保留前 1 MiB，已停止读取。')).toBeVisible()
  }
})
for (const theme of ['light', 'dark']) test(`${theme} appearance and responsive layout`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  await page.evaluate(theme => (window.mossApp as any).update(theme, theme === 'dark' ? 'dot-theme' : 'grid-theme'), theme)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await page.getByRole('textbox', { name: '请求地址' }).fill(`${target}/bigint`)
  await send(page)
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveValue(/9007199254740993/)
  const directory = path.resolve(import.meta.dirname, '../../../artifacts/moss.http-client/screenshots/0.1.0')
  await mkdir(directory, { recursive: true })
  await page.screenshot({ path: path.join(directory, `http-${theme}.png`) })
  for (const width of [760, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 740 })
    for (const name of ['参数', '请求头', '正文', '鉴权', '选项']) {
      await page.locator('.request-tabs').getByRole('button', { name, exact: true }).click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    }
  }
  await page.screenshot({ path: path.join(directory, `http-${theme}-narrow.png`) })
  expect(errors).toEqual([])
})
test('host errors remain visible and appearance failure falls back without clearing inputs', async ({ page }) => {
  await setup(page)
  await page.getByRole('textbox', { name: '请求地址' }).fill(`${target}/echo`)
  await page.evaluate(() => { (window.mossApp as any).fail = true; (window.mossApp as any).update('dark', 'dot-theme') })
  await expect(page.getByText('服务异常，请在 Moss 中重启')).toBeVisible()
  await send(page)
  await expect(page.getByRole('alert')).toContainText('暂时无法连接本地服务')
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveCount(0)
  await page.evaluate(() => { window.mossApp!.app.getInfo = async () => { throw new Error('unavailable') }; window.dispatchEvent(new Event('focus')) })
  await expect(page.locator('html')).toHaveAttribute('data-background-style', 'grid-theme')
  await expect(page.getByRole('textbox', { name: '请求地址' })).toHaveValue(`${target}/echo`)
})
test('ordinary browser remains usable for editing and does not fake network responses', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('浏览器预览 · 在 Moss 中发送请求')).toBeVisible()
  await page.getByRole('button', { name: '填入示例' }).click()
  await send(page)
  await expect(page.getByRole('alert')).toContainText('请在 Moss 中打开')
  await expect(page.getByRole('textbox', { name: '响应正文' })).toHaveCount(0)
})
test('storage write failure preserves current input and does not invent a saved template', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => { window.mossApp!.storage.setItem = async () => { throw new Error('storage unavailable') } })
  await page.getByRole('textbox', { name: '请求地址' }).fill(`${target}/echo`)
  await page.getByRole('button', { name: '保存模板', exact: true }).click()
  await page.getByRole('textbox', { name: '模板名称' }).fill('待保存接口')
  await page.getByRole('button', { name: '确认保存' }).click()
  await expect(page.getByRole('alert')).toContainText('模板保存失败')
  await expect(page.getByRole('textbox', { name: '请求地址' })).toHaveValue(`${target}/echo`)
  await expect(page.getByRole('button', { name: 'GET 待保存接口' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '确认保存' })).toBeEnabled()
})
