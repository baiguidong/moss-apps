import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { readFileSync } from 'node:fs'
const manifest = JSON.parse(readFileSync(new URL('../app.moss.json', import.meta.url), 'utf8'))
const screenshots = path.resolve(import.meta.dirname, '../../..', 'artifacts/moss.drive/screenshots', manifest.version)

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('browser demo supports folder navigation, upload, pause, resume and download', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByText('浏览器演示', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '项目资料', exact: true }).click()
  await expect(page.getByText('使用说明.md', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '全部文件', exact: true }).click()
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  await (await picker).setFiles({ name: '测试上传.txt', mimeType: 'text/plain', buffer: Buffer.from('Moss drive upload smoke test\n'.repeat(50)) })
  await expect(page.getByRole('heading', { name: /上传记录/ })).toBeVisible()
  await page.getByRole('button', { name: '暂停 测试上传.txt', exact: true }).click()
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '继续 测试上传.txt', exact: true }).click()
  await expect(page.getByText('已完成', { exact: true })).toBeVisible({ timeout: 12_000 })
  await page.getByRole('tab', { name: '全部文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '下载 测试上传.txt', exact: true })).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 测试上传.txt', exact: true }).click()
  expect((await downloaded).suggestedFilename()).toBe('测试上传.txt')
  await expectNoOverflow(page)
  expect(errors).toEqual([])
})

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} appearance and compact layout`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await page.goto('/')
    await expect(page.getByText('项目说明.md', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await mkdir(screenshots, { recursive: true })
    const folderText = page.getByRole('button', { name: '项目资料', exact: true })
    expect(await folderText.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: path.join(screenshots, `${theme}.png`) })
    for (const width of [760, 640, 600, 581]) {
      await page.setViewportSize({ width, height: 760 })
      await expectNoOverflow(page)
      await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeInViewport()
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('button', { name: '下载 项目说明.md', exact: true })).toBeVisible()
    await expectNoOverflow(page)
    await page.screenshot({ path: path.join(screenshots, `${theme}-narrow.png`) })
    await page.setViewportSize({ width: 320, height: 720 })
    await expectNoOverflow(page)
    await page.getByRole('button', { name: '新建目录', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建目录' })
    await dialog.getByRole('textbox').fill('项目资料归档')
    await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeInViewport()
    await expectNoOverflow(page)
    await page.screenshot({ path: path.join(screenshots, `${theme}-create-narrow.png`) })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '归档', exact: true }).click()
    await expect(page.getByRole('heading', { name: '还没有文件', exact: true })).toBeVisible()
  })
}

async function hostFixture(page: Page, state = 'ready', runtime = 'running') {
  await page.addInitScript(({ state, runtime }) => {
    const listeners = new Map<string, Set<(event: unknown) => void>>()
    const file = { id: 'real', parentId: null, name: '服务文件.txt', kind: 'file', size: 12, revision: '1', createdAt: 1, updatedAt: 1 }
    const bridge: any = {
      state, runtime, files: [file], tasks: [], appearance: { themeMode: 'dark', cssThemeId: 'dot-theme' },
      emit: (name: string, event: unknown) => listeners.get(name)?.forEach(cb => cb(event)),
      app: { getInfo: async () => ({ appearance: bridge.appearance }), getInstallationState: async () => ({ installation: { enabled: true } }) },
      instances: { list: async () => [{ id: 'default' }], getStatus: async () => ({ state: bridge.runtime }) },
      actions: { invoke: async (_id: string, method: string, input: any) => {
        if (method === 'files.delete') return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'No deletion grant' } }
        if (method === 'status.get') return { ok: true, data: { state: bridge.state } }
        if (method === 'files.list') return { ok: true, data: { files: bridge.files, nextCursor: null } }
        if (method === 'quota.get') return { ok: true, data: { usedBytes: 12, reservedBytes: 0, limitBytes: 1024 } }
        if (method === 'transfers.list') return { ok: true, data: { transfers: bridge.tasks, nextCursor: null } }
        if (method === 'downloads.start') return { ok: false, error: { code: 'CANCELLED', message: 'User cancelled' } }
        return { ok: false, error: { code: 'REQUEST_FAILED', message: 'Unsupported test action' } }
      }, cancel: async () => ({ canceled: true }) },
      events: { on: (name: string, cb: (event: unknown) => void) => { const entries = listeners.get(name) || new Set(); entries.add(cb); listeners.set(name, entries); return () => entries.delete(cb) } },
    }
    window.mossApp = bridge
  }, { state, runtime })
}

test('Moss bridge uses real mode, clears account state and follows appearance on focus', async ({ page }) => {
  await hostFixture(page)
  await page.goto('/')
  await expect(page.getByText('服务文件.txt', { exact: true })).toBeVisible()
  await expect(page.getByText('服务运行中', { exact: true })).toBeVisible()
  await expect(page.getByText('浏览器演示', { exact: true })).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-background-style', 'dot-theme')
  await page.getByRole('button', { name: '下载 服务文件.txt' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.evaluate(() => {
    const bridge = window.mossApp as any
    bridge.state = 'unauthenticated'
    bridge.emit('cloud.event', { name: 'storage.status-changed', data: { state: 'unauthenticated' } })
    bridge.appearance = { themeMode: 'light', cssThemeId: 'gradient-theme' }
    window.dispatchEvent(new Event('focus'))
  })
  await expect(page.getByText('服务文件.txt', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '需要登录服务器' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).toHaveAttribute('data-background-style', 'gradient-theme')
})

test('unavailable cloud and stopped backend remain visible and retryable', async ({ page }) => {
  await hostFixture(page, 'unavailable', 'stopped')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '暂时无法连接网盘' })).toBeVisible()
  await expect(page.getByText('服务已停止', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新连接' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '上传文件' })).toBeDisabled()
})


test('completed uploads stay in their tab and history retains the transfer direction', async ({ page }) => {
  await page.goto('/')
  const picker = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  await (await picker).setFiles({ name: '自动收起.txt', mimeType: 'text/plain', buffer: Buffer.from('verify'.repeat(100)) })
  await expect(page.getByRole('heading', { name: /上传记录/ })).toBeVisible()
  await expect(page.getByText('已完成', { exact: true })).toBeVisible({ timeout: 12_000 })
  await expect(page.getByRole('tab', { name: '上传', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('transfer-announcement')).toHaveCount(0)
  await page.getByRole('tab', { name: '全部文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '下载 自动收起.txt', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '上传', exact: true }).click()
  await expect(page.getByTestId('transfer-row').getByLabel('上传', { exact: true })).toBeVisible()
  await expect(page.getByTestId('transfer-row').getByText('100%', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('transfer-row').locator('.transfer-meta')).toHaveCount(0)
})

test('top tabs separate directions and leave the file area clear in a short viewport', async ({ page }) => {
  await hostFixture(page)
  await page.goto('/')
  await expect(page.getByText('服务文件.txt', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const bridge = window.mossApp as any
    bridge.appearance = { themeMode: 'light', cssThemeId: 'default' }
    bridge.files = ['项目说明.pdf', '资料清单.csv', '会议记录.txt'].map((name, i) => ({ ...bridge.files[0], id: `file-${i}`, name }))
    bridge.tasks = bridge.files.map((file: any, i: number) => ({ id: `task-${i}`, transferId: `task-${i}`, name: file.name, direction: i === 1 ? 'download' : 'upload', fileId: file.id, state: 'completed', totalBytes: 1024, transferredBytes: 1024, error: null, createdAt: i, updatedAt: i }))
    window.dispatchEvent(new Event('focus'))
  })
  await page.setViewportSize({ width: 1120, height: 570 })
  await expect(page.getByTestId('file-row')).toHaveCount(3)
  await page.getByRole('tab', { name: '上传', exact: true }).click()
  await expect(page.getByTestId('transfer-row')).toHaveCount(2)
  await expect(page.getByTestId('transfer-row').getByLabel('下载', { exact: true })).toHaveCount(0)
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: path.join(screenshots, 'uploads.png') })
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '下载', exact: true })).toBeFocused()
  await expect(page.getByTestId('transfer-row')).toHaveCount(1)
  await page.screenshot({ path: path.join(screenshots, 'downloads.png') })
  await page.keyboard.press('Home')
  await expect(page.getByRole('tab', { name: '全部文件', exact: true })).toBeFocused()
  await expect(page.getByTestId('file-row')).toHaveCount(3)
  await expect(page.getByTestId('transfer-row')).toHaveCount(0)
  const fits = await page.evaluate(() => {
    const area = document.querySelector('.file-scroll')!.getBoundingClientRect()
    return [...document.querySelectorAll('[data-testid="file-row"]')].every(row => row.getBoundingClientRect().bottom <= area.bottom)
  })
  expect(fits).toBe(true)
  await page.screenshot({ path: path.join(screenshots, 'files.png') })
  await page.getByRole('button', { name: '更新文件列表', exact: true }).click()
  await expect(page.getByRole('tab', { name: '全部文件', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('create in root and nested directories, validate names, and preserve the path across tabs', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建目录' })
  await expect(dialog.getByRole('textbox', { name: '目录名称' })).toBeFocused()
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('请输入目录名称。')
  await dialog.getByRole('textbox').fill('a/b')
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('斜杠')
  await dialog.getByRole('textbox').fill('新项目')
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: '新项目', exact: true }).click()
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  await expect(dialog.getByText('新项目', { exact: true })).toBeVisible()
  await dialog.getByRole('textbox').fill('资料')
  await dialog.getByRole('textbox').press('Enter')
  await expect(page.getByRole('button', { name: '资料', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '上传', exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有上传任务' })).toBeVisible()
  await page.getByRole('tab', { name: '下载', exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有下载任务' })).toBeVisible()
  await page.getByRole('tab', { name: '全部文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '资料', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  await dialog.getByRole('textbox').fill('资料')
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('同名')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '新建目录', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '全部文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '新项目', exact: true })).toBeVisible()
})

test('deletion names the file, defaults to cancel, and refreshes list and quota after confirmation', async ({ page }) => {
  await page.goto('/')
  const quota = await page.locator('.quota').getAttribute('title')
  const deleting = page.getByRole('button', { name: '删除 项目说明.md', exact: true })
  await deleting.click()
  const dialog = page.getByRole('dialog', { name: '删除文件' })
  await expect(dialog.getByText('项目说明.md', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(deleting).toBeVisible()
  await deleting.click()
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: path.join(screenshots, 'delete-confirmation.png') })
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('项目说明.md', { exact: true })).toHaveCount(0)
  await expect(page.locator('.quota')).not.toHaveAttribute('title', quota!)
  await expect(page.getByRole('button', { name: '删除 项目资料', exact: true })).toHaveCount(0)
})

test('delete permission failure remains visible and account invalidation closes the dialog', async ({ page }) => {
  await hostFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: '删除 服务文件.txt', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '删除文件' })
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('权限')
  await expect(page.getByTestId('file-row')).toHaveCount(1)
  await page.evaluate(() => {
    const bridge = window.mossApp as any
    bridge.state = 'unauthenticated'
    bridge.emit('cloud.event', { name: 'storage.status-changed', data: { state: 'unauthenticated' } })
  })
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('file-row')).toHaveCount(0)
})
