import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import engine from '../src/backend/engine.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = process.env.MOSS_HYPERFRAMES_OUTPUT || path.join(os.tmpdir(), 'hyperframes-redesign')
const require = createRequire(import.meta.url)
const playwrightPath = process.env.MOSS_PLAYWRIGHT_MODULE || createRequire(require.resolve('@playwright/test', { paths: [path.join(root, '../drive')] })).resolve('playwright')
const playwright = await import(pathToFileURL(playwrightPath).href)
const { chromium } = playwright.default || playwright
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperframes-ui-'))
const actions = new Map(), calls = [], composer = [], tasks = [], errors = []
let page, browser, theme = 'light', exported = false, taskSequence = 0, failTaskRead = false
async function screenshot({ path: target }) {
  await page.evaluate(() => { window.scrollTo(0, 0); (document.activeElement instanceof HTMLElement) && document.activeElement.blur() })
  await page.screenshot({ path: target, fullPage: true, animations: 'disabled', timeout: 12000 })
}
const emit = async () => { if (page) await page.evaluate(() => window.__events['workspace.changed']?.()).catch(() => {}) }
await engine.register({ registerAction: (name, handler) => actions.set(name, handler), emit: () => { void emit() } }, { dataDir: temp })
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const file = url.pathname === '/render-smoke.mp4' ? path.join(output, 'render-smoke.mp4') : path.join(root, 'dist/ui', relative)
    const bytes = await fs.readFile(file)
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.mp4') ? 'video/mp4' : 'text/html')
    res.end(bytes)
  } catch { res.writeHead(404); res.end() }
})
try {
  await fs.mkdir(output, { recursive: true })
  await fs.access(path.join(output, 'render-smoke.mp4')).catch(() => { throw new Error(`Run test:render first with MOSS_HYPERFRAMES_OUTPUT=${output}`) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-gpu'], timeout: 30000 })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => errors.push(error.message))
  await page.exposeFunction('testInfo', () => ({ appearance: { themeMode: theme, cssThemeId: 'grid-theme' } }))
  await page.exposeFunction('testPrepare', async input => { composer.push(input); const { providerId, ...context } = input; return { ok: true, ...(await actions.get('composer.resolve')(context)) } })
  await page.exposeFunction('testAction', async (name, input) => {
    calls.push({ name, input })
    try {
      let result
      if (name === 'workspace.get') result = { tasks }
      else if (name === 'tasks.start') {
        result = { id: `task-${++taskSequence}`, input, status: 'running', createdAt: Date.now(), message: '正在渲染', artifacts: [] }
        tasks.unshift(result)
      } else if (name === 'tasks.get') { if (failTaskRead) throw new Error('测试：视频地址暂不可用'); result = tasks.find(task => task.id === input.id) }
      else if (name === 'tasks.cancel') { result = tasks.find(task => task.id === input.id); result.status = 'canceled'; await emit() }
      else if (name === 'artifacts.export') { exported = true; result = { path: '/test-export/video.mp4' } }
      else result = await actions.get(name)(input)
      return { ok: true, result }
    } catch (error) { return { ok: false, error: { message: error.message, code: 'TEST_ERROR' } } }
  })
  await page.addInitScript(() => {
    window.__events = {}
    window.mossApp = { app: { getInfo: () => window.testInfo() }, composer: { prepare: input => window.testPrepare(input) }, actions: { invoke: (name, input) => window.testAction(name, input), cancel: async () => ({ cancelled: true }) }, events: { on: (name, callback) => { window.__events[name] = callback; return () => delete window.__events[name] } } }
  })
  await page.goto(base)
  await page.getByRole('button', { name: '创建示例项目' }).waitFor()
  const demos = page.getByLabel('示例快捷输入')
  assert.equal(await demos.getByRole('button').count(), 4)
  await demos.getByRole('button', { name: '知识讲解' }).click()
  assert.match(await page.getByRole('textbox', { name: '视频创作需求' }).inputValue(), /复利/)
  assert.equal(await page.getByLabel('画面比例').inputValue(), '9:16')
  await page.getByRole('button', { name: '开始创作', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '创作草稿已带到主会话' }).waitFor()
  assert.equal(composer[0].intent, 'create')
  assert.equal(composer[0].providerId, 'video-projects')
  assert.equal(composer[0].ref.duration, 30)
  await demos.getByRole('button', { name: '产品介绍' }).click()
  await page.getByRole('button', { name: '关闭提示' }).click()
  await screenshot({ path: path.join(output, 'home-light.png'), fullPage: true })
  await page.getByRole('button', { name: '创建示例项目' }).click()
  await page.getByRole('tab', { name: '场景预览' }).waitFor()
  const project = (await actions.get('projects.list')()).projects[0]
  await page.getByRole('button', { name: '主会话中继续' }).click()
  await page.getByRole('status').filter({ hasText: '创作草稿已带到主会话' }).waitFor()
  assert.equal(composer.at(-1).ref.projectId, project.id)
  assert.equal(composer.at(-1).intent, 'edit')
  // Simulate the host's canonical workbench return route.
  await page.goto(`${base}/#/workbench?target=${encodeURIComponent(`#/projects/${project.id}`)}`)
  await page.getByRole('tab', { name: '场景预览' }).waitFor()
  await page.getByRole('button', { name: '编辑分镜' }).click()
  await page.getByLabel('镜头标题').fill('新版开场')
  await page.getByRole('button', { name: '保存修改' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await actions.get('projects.get')({ id: project.id })).storyboard.scenes[0].title, '新版开场')
  const saved = await actions.get('projects.get')({ id: project.id })
  await actions.get('projects.storyboard.save')({ id: project.id, storyboard: { scenes: saved.storyboard.scenes.map((item, index) => index === 1 ? { ...item, title: '来自主会话的修改' } : item) } })
  await page.getByRole('button', { name: /来自主会话的修改/ }).waitFor()
  await page.getByRole('button', { name: '渲染视频', exact: true }).click()
  await page.getByRole('button', { name: '开始渲染', exact: true }).click()
  await page.getByRole('heading', { name: '正在把画面变成视频' }).waitFor()
  assert.equal(calls.findLast(item => item.name === 'tasks.start').input.projectId, project.id)
  tasks[0].status = 'failed'; tasks[0].message = "Cannot find package 'hono' imported from /private/engine.js"
  await emit()
  await page.getByText('渲染引擎缺少运行依赖，请更新 App 后重新渲染。已保存的项目仍可继续编辑。').waitFor()
  await screenshot({ path: path.join(output, 'render-error.png'), fullPage: true })
  await page.getByRole('button', { name: '重新渲染', exact: true }).click()
  await page.getByRole('button', { name: '开始渲染', exact: true }).click()
  await page.getByRole('button', { name: '取消渲染', exact: true }).waitFor()
  await page.getByRole('button', { name: '取消渲染', exact: true }).click()
  await page.getByText('已取消', { exact: true }).waitFor()
  tasks[0].status = 'succeeded'; tasks[0].message = '渲染成功'; tasks[0].result = { bytes: 1024, fps: 5, projectId: project.id }; tasks[0].artifacts = [{ kind: 'video', name: 'video.mp4', url: `${base}/render-smoke.mp4` }]
  failTaskRead = true
  await emit()
  await page.getByRole('heading', { name: '视频暂时无法播放' }).waitFor()
  failTaskRead = false
  await page.getByRole('button', { name: '重新加载视频' }).click()
  await page.getByRole('button', { name: '导出 MP4' }).waitFor()
  await page.waitForFunction(() => { const video = document.querySelector('video'); if (video?.error) throw new Error(video.error.message); return video && video.readyState >= 1 })
  for (const time of [0, 6, 11]) {
    await page.locator('video').evaluate(async (video, time) => { video.currentTime = time; await video.play() }, time)
    await page.waitForFunction(time => { const video = document.querySelector('video'); return video && !video.seeking && video.currentTime >= time && video.readyState >= 2 }, time)
    await page.locator('video').evaluate(video => video.pause())
  }
  await page.getByRole('button', { name: '导出 MP4' }).click()
  assert.ok(exported)
  assert.deepEqual(calls.findLast(item => item.name === 'artifacts.export').input, { id: tasks[0].id, index: 0 })
  await screenshot({ path: path.join(output, 'project-result.png'), fullPage: true })
  // History sits below the preview. Clicking the arrow must bring the selected
  // player's controls into view, including when selecting the same take again.
  const newest = tasks[0]
  for (let index = 1; index <= 3; index++) tasks.splice(index, 0, { ...newest, id: `history-${index}`, createdAt: newest.createdAt - index * 60000,
    artifacts: [{ kind: 'video', name: `take-${index}.mp4`, url: `${base}/render-smoke.mp4?take=${index}` }] })
  await emit()
  const rows = page.locator('.result-row')
  await page.waitForFunction(() => document.querySelectorAll('.result-row').length === 4)
  const expectPlayerInView = () => page.waitForFunction(() => {
    const video = document.querySelector('video'), rect = video?.getBoundingClientRect()
    return video?.readyState >= 2 && rect.top >= 0 && rect.bottom <= innerHeight && document.querySelector('#video-preview').getBoundingClientRect().top >= 0 && document.activeElement?.id === 'video-preview'
  })
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByRole('tab', { name: '场景预览' }).click()
  await rows.last().locator('svg').last().click()
  await expectPlayerInView()
  assert.equal(await page.getByRole('tab', { name: /渲染成片/ }).getAttribute('aria-selected'), 'true')
  assert.match(await page.locator('video').getAttribute('src'), /take=3$/)
  assert.ok(await page.locator('.preview-footer').innerText().then(text => text.includes(new Date(tasks[3].createdAt).toLocaleString('zh-CN'))))
  await page.getByRole('button', { name: '导出 MP4' }).click()
  assert.deepEqual(calls.findLast(item => item.name === 'artifacts.export').input, { id: 'history-3', index: 0 })
  await rows.last().getByText('查看视频').click()
  await expectPlayerInView()
  // Keyboard activation, a smaller viewport, and the latest-result shortcut
  // must all target the same visible player rather than a hidden tab change.
  await page.setViewportSize({ width: 390, height: 844 })
  await rows.nth(1).scrollIntoViewIfNeeded()
  await rows.nth(1).focus()
  await rows.nth(1).press('Enter')
  await expectPlayerInView()
  assert.match(await page.locator('video').getAttribute('src'), /take=1$/)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Video history overflows on mobile')
  await page.screenshot({ path: path.join(output, 'history-player-mobile.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '查看成片', exact: true }).click()
  await expectPlayerInView()
  assert.equal(await page.locator('video').getAttribute('src'), newest.artifacts[0].url)
  await page.setViewportSize({ width: 1440, height: 1050 })
  // A different project must not retain the previous project's video or status.
  const other = await actions.get('projects.create')({ name: '另一个竖屏项目', aspectRatio: '9:16' })
  await page.getByRole('button', { name: /另一个竖屏项目/ }).click()
  assert.equal(await page.locator('video').count(), 0)
  assert.equal(await page.getByLabel('渲染任务').count(), 0)
  await page.frameLocator('iframe[title="当前场景预览"]').getByRole('heading', { name: '认识产品' }).waitFor()
  await screenshot({ path: path.join(output, 'portrait-project.png'), fullPage: true })
  theme = 'dark'
  await page.evaluate(() => window.__events.appearance?.())
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.backgroundStyle), 'grid-theme')
  await page.waitForFunction(() => {
    const button = document.querySelector('.primary'), probe = document.createElement('span')
    probe.style.color = 'var(--primary)'; document.body.append(probe)
    const matches = getComputedStyle(button).backgroundColor === getComputedStyle(probe).color
    probe.remove(); return matches
  })
  await screenshot({ path: path.join(output, 'project-dark.png'), fullPage: true })
  theme = 'light'; await page.evaluate(() => window.__events.appearance?.())
  await page.getByRole('button', { name: '新建视频' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '创建示例项目' }).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout overflows')
  await screenshot({ path: path.join(output, 'home-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: '了解工作流程' }).click()
  await page.getByRole('heading', { name: 'HyperFrames 是什么？' }).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await screenshot({ path: path.join(output, 'guide-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  const report = { passed: true, checks: ['four demo prompts', 'composer creation and project context', 'host return route', 'storyboard persistence', 'Agent changes sync', 'render failure and retry', 'cancel', 'completed task with result metadata', 'artifact load retry', 'real MP4 playback and seeking', 'artifact export', 'history arrow reveals selected player', 'repeat history selection', 'keyboard and mobile history selection', 'selected history export', 'latest result shortcut', 'project isolation', 'portrait preview', 'dark theme', 'mobile overflow', 'guide'], screenshots: output }
  await fs.writeFile(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  if (page && !page.isClosed()) { console.error((await page.locator('body').innerText()).slice(0, 5000)); await screenshot({ path: path.join(output, 'failure.png'), fullPage: true }) }
  console.error('Page errors:', errors)
  throw error
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(temp, { recursive: true, force: true }) }
