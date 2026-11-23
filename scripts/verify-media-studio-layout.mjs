import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { AppProcessSupervisor } from '../vendor/moss-core/packages/app-runtime/src/process/index.mjs'

const app = fileURLToPath(new URL('../apps/media-studio/', import.meta.url))
const packageRoot = process.argv[2] ? path.resolve(process.argv[2]) : app
const require = createRequire(path.join(app, 'package.json'))
const { chromium, expect } = require('@playwright/test')
const { preview } = require('vite')
const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'app.moss.json')))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-layout-'))
const supervisor = new AppProcessSupervisor({ processesDir: path.join(temp, 'processes'),
  onHostRequest({ protocol, method }) {
    if (protocol === 'moss.runtime/v1') return { active: method !== 'activity.end' }
    throw new Error('Unexpected host request ' + protocol + '/' + method)
  },
})
let browser, server
try {
  supervisor.register({ key: 'studio', appId: manifest.id, version: manifest.version, instanceId: 'studio', generation: 1,
    packageRoot, entry: manifest.backend.entry, lifecycle: 'on-demand', protocols: manifest.host.protocols,
    permissions: manifest.permissions, dataDir: path.join(temp, 'data'), runtimeDir: path.join(temp, 'runtime') })
  const invoke = (name, input = {}) => supervisor.invoke('studio', name, input, { timeoutMs: 30000, invocation: { surface: 'ui' } })
  server = await preview({ configFile: false, root: packageRoot, build: { outDir: 'dist/ui' }, preview: { port: 0, host: '127.0.0.1' } })
  const url = 'http://127.0.0.1:' + server.httpServer.address().port
  browser = await chromium.launch({ executablePath: process.env.MOSS_CHROMIUM_PATH || undefined, headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.exposeFunction('invokeStudio', async (name, input) => {
    try { return { ok: true, result: await invoke(name, input) } }
    catch (error) { return { ok: false, error: { message: error.message } } }
  })
  await page.addInitScript(() => {
    window.mossApp = { app: { getInfo: async () => ({ appearance: { themeMode: 'system' } }) },
      events: { on: () => () => {} }, actions: { invoke: window.invokeStudio, cancel: async () => {} } }
  })
  const button = name => page.getByRole('button', { name, exact: true })
  const snap = async name => {
    if (process.env.MOSS_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.MOSS_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.MOSS_SCREENSHOT_DIR, name + '.png') })
    }
  }
  const checkDivider = async () => {
    const nav = await page.locator('.workspace-nav').boundingBox(), layout = await page.locator('.studio-layout').boundingBox()
    assert(Math.abs(nav.y + nav.height - layout.y - layout.height) < 2, 'divider reaches the bottom of the work area')
    const footer = await page.locator('.engine-app > footer').boundingBox()
    assert(Math.abs(nav.y + nav.height - footer.y) < 2, 'divider meets the footer')
    assert(layout.height > 650, 'short pages fill the window')
  }

  await page.goto(url)
  await checkDivider()
  await button('分镜动画').click()
  await expect(button('展开导航')).toBeVisible()
  assert((await page.locator('.workspace-nav').boundingBox()).width < 50)
  await checkDivider()
  await button('新建视频').click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  assert.equal((await invoke('animation.projects.list')).projects.length, 0)

  await button('新建视频').click()
  const dialog = page.getByRole('dialog', { name: '新建视频' })
  await dialog.getByLabel('项目名称').fill('季度短片')
  await dialog.getByLabel('画面比例').selectOption('9:16')
  await dialog.getByLabel('时长（秒）').fill('30')
  await dialog.getByLabel('分镜模板').selectOption('data-report')
  await dialog.getByRole('button', { name: '创建项目' }).click()
  await expect(page.getByRole('heading', { name: '季度短片' })).toBeVisible()
  const [project] = (await invoke('animation.projects.list')).projects
  assert.equal(project.duration, 30)
  assert.equal(project.aspectRatio, '9:16')
  assert.equal(project.templateId, 'data-report')
  assert(page.url().endsWith('#/animation/' + project.id))
  await button('创作工作台').click()
  await expect(page.getByRole('heading', { name: '从示例开始' })).toBeVisible()
  assert(page.url().endsWith('#/animation'))
  await page.getByLabel('打开分镜项目').selectOption(project.id)
  await expect(page.getByRole('heading', { name: '季度短片' })).toBeVisible()
  await button('展开导航').click()
  await page.reload()
  await expect(button('收起导航')).toBeVisible()
  await button('收起导航').click()
  await snap('animation')
  await page.goto(url + '/#/workbench?target=' + encodeURIComponent('#/animation/' + project.id))
  await button('创作工作台').click()
  await page.reload()
  await expect(page.getByRole('heading', { name: '从示例开始' })).toBeVisible()
  assert.equal(new URLSearchParams(page.url().split('?')[1]).get('target'), '#/animation')

  const title = '季度汇报素材文件及本地项目'.repeat(7)
  const avatar = await invoke('projects.create', { fields: { name: title, script: '测试。' } })
  for (let i = 0; i < 4; i++) await invoke('renders.submit', { id: avatar.id, version: avatar.version })
  await button('任务中心').click()
  await button('刷新').click()
  const rows = page.locator('.activity-item')
  await expect(rows).toHaveCount(4)
  for (const width of [1200, 940, 720, 390]) {
    await page.setViewportSize({ width, height: 800 })
    const boxes = await rows.evaluateAll(items => items.map(item => {
      const title = item.querySelector('.activity-name').getBoundingClientRect()
      const status = item.querySelector('.activity-status').getBoundingClientRect()
      const box = item.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, separate: title.right <= status.left }
    }))
    assert(boxes.every((box, i) => box.separate && (!i || box.top >= boxes[i - 1].bottom - 1)))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    if (width === 1200) { await checkDivider(); await snap('tasks-wide') }
  }
  await expect(page.locator('.task-detail')).toBeHidden()
  await snap('tasks-narrow')
  await rows.nth(2).click()
  await expect(page.locator('.task-detail')).toBeVisible()
  await expect(rows.first()).toBeHidden()
  await button('返回任务列表').click()
  await expect(rows.nth(2)).toBeFocused()
  await page.getByLabel('切换工作区').selectOption('分镜动画')
  await button('使用指南').click()
  await button('创作工作台').click()
  await expect(page.getByRole('heading', { name: '从示例开始' })).toBeVisible()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  console.log('Verified navigation, divider, persisted video creation, workbench routes and task layouts at four widths.')
} finally {
  await browser?.close()
  await supervisor.shutdown()
  await server?.close()
  await fs.rm(temp, { recursive: true, force: true })
}
