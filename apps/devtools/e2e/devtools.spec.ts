import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
const shots = path.resolve(import.meta.dirname, '../../../artifacts/moss.devtools/screenshots/0.1.0')
test('timestamp converts in both directions and explains invalid dates', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: '时间戳', exact: true }).fill('1704067200123')
  await page.getByRole('button', { name: '转换', exact: true }).click()
  await expect(page.getByText('2024-01-01 08:00:00.123 (UTC+08:00)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '日期 → 时间戳' }).click()
  await page.getByRole('textbox', { name: '日期时间' }).fill('2023-02-29 12:00:00')
  await page.getByRole('button', { name: '转换', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('日期不存在')
  await page.getByRole('button', { name: '当前时间' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '复制毫秒时间戳' })).toBeEnabled()
})
test('Base64 Unicode roundtrip, strict errors and input changes clear stale results', async ({ page }) => {
  await page.goto('/#/base64')
  await page.getByRole('button', { name: '填入示例', exact: true }).click()
  await page.getByRole('button', { name: '编码为 Base64' }).click()
  await expect(page.getByRole('textbox', { name: '转换结果' })).toHaveValue(Buffer.from('你好，Moss 👋').toString('base64'))
  await page.getByRole('button', { name: '结果用作输入' }).click()
  await page.getByRole('button', { name: '解码为文本' }).click()
  await expect(page.getByRole('textbox', { name: '转换结果' })).toHaveValue('你好，Moss 👋')
  await page.getByRole('textbox', { name: '输入内容' }).fill('%%%%')
  await expect(page.getByRole('textbox', { name: '转换结果' })).toHaveValue('')
  await page.getByRole('button', { name: '解码为文本' }).click()
  await expect(page.getByRole('alert')).toContainText('Base64')
})
test('JSON preserves large numbers and reports actionable errors', async ({ page }) => {
  await page.goto('/#/json')
  await page.getByRole('button', { name: '填入示例' }).click()
  await page.getByRole('button', { name: '格式化', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'JSON 结果' })).toHaveValue(/9007199254740993/)
  await expect(page.getByRole('status')).toContainText('格式正确')
  await page.getByRole('textbox', { name: 'JSON 输入' }).fill('{\n "x":\n}')
  await page.getByRole('button', { name: '校验', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('第 3 行')
})
test('AES generates keys and fresh IVs, decrypts, and rejects modified ciphertext', async ({ page }) => {
  await page.goto('/#/aes')
  await page.getByRole('button', { name: '生成密钥' }).click()
  await page.getByRole('textbox', { name: '待加密文本' }).fill('Moss 本地加密 👋')
  await page.getByRole('button', { name: '加密文本' }).click()
  const first = await page.locator('.iv-result code').textContent()
  await expect(page.getByRole('textbox', { name: '加密结果' })).not.toHaveValue('')
  await page.getByRole('button', { name: '加密文本' }).click()
  await expect(page.locator('.iv-result code')).not.toHaveText(first!)
  await page.getByRole('button', { name: '用此结果解密' }).click()
  const cipher = await page.getByRole('textbox', { name: '待解密密文' }).inputValue()
  await page.getByRole('button', { name: '解密文本' }).click()
  await expect(page.getByRole('textbox', { name: '解密结果' })).toHaveValue('Moss 本地加密 👋')
  await page.getByRole('textbox', { name: '待解密密文' }).fill((cipher[0] === 'A' ? 'B' : 'A') + cipher.slice(1))
  await page.getByRole('button', { name: '解密文本' }).click()
  await expect(page.getByRole('alert')).toContainText('解密失败')
  await page.getByRole('button', { name: '清空内容与密钥' }).click()
  await expect(page.getByLabel('密钥', { exact: true })).toHaveValue('')
})
for (const theme of ['light', 'dark'] as const) test(`${theme} screenshots, all tools and responsive layout`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ colorScheme: theme })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await mkdir(shots, { recursive: true })
  for (const [name, id] of [['时间戳', 'timestamp'], ['Base64', 'base64'], ['AES', 'aes'], ['JSON', 'json']]) {
    await page.getByRole('link', { name, exact: true }).click()
    await page.screenshot({ path: path.join(shots, `${id}-${theme}.png`) })
    for (const width of [760, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 740 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const panel = page.locator('main > section:visible')
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    }
    await page.screenshot({ path: path.join(shots, `${id}-${theme}-narrow.png`) })
    await page.setViewportSize({ width: 1080, height: 740 })
  }
  expect(errors).toEqual([])
})
test('follows host appearance events and reports backend failures without falling back', async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks = new Map<string, (data: unknown) => void>()
    const bridge: any = { appearance: { themeMode: 'dark', cssThemeId: 'dot-theme' },
      app: { getInfo: async () => ({ appearance: bridge.appearance }), getInstallationState: async () => ({ enabled: true }) },
      instances: { list: async () => [{ id: 'default' }], getStatus: async () => ({ state: 'error' }) },
      events: { on: (name: string, fn: (data: unknown) => void) => { callbacks.set(name, fn); return () => callbacks.delete(name) } },
      actions: { invoke: async () => { throw new Error('Backend unavailable') } },
      changeTheme: () => { bridge.appearance = { themeMode: 'light', cssThemeId: 'gradient-theme' }; callbacks.get('appearance')?.({}) },
    }
    window.mossApp = bridge
  })
  await page.goto('/#/base64')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-background-style', 'dot-theme')
  await expect(page.getByText('服务异常，请在 Moss 中重启')).toBeVisible()
  await page.getByRole('button', { name: '填入示例' }).click()
  await page.getByRole('button', { name: '编码为 Base64' }).click()
  await expect(page.getByRole('alert')).toContainText('暂时无法连接本地服务')
  await expect(page.getByRole('textbox', { name: '转换结果' })).toHaveValue('')
  await page.evaluate(() => (window.mossApp as any).changeTheme())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).toHaveAttribute('data-background-style', 'gradient-theme')
})
