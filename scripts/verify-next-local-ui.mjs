import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { assertAppContentLayout, assertAppWorkspaceLayout } from './app-layout-check.mjs'

const repo = fileURLToPath(new URL('..', import.meta.url))
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const require = createRequire(path.join(repo, 'apps/media-tools/package.json'))
const requireCore = createRequire(path.join(core, 'ui/package.json'))
const { _electron: electron, expect } = require('@playwright/test')
const { build } = require('vite')
const { default: react } = require('@vitejs/plugin-react')
const output = path.join(repo, 'artifacts/next-local-apps/ui')
const shell = path.join(output, 'shell/index.html')
const styles = path.join(output, 'shell.css')
await fs.mkdir(output, { recursive: true })
await fs.writeFile(styles, '@import ' + JSON.stringify(path.join(core, 'ui/src/renderer-react/globals.css')) + ';\n@source ' + JSON.stringify(path.join(core, 'ui/src/renderer-react/components')) + ';\n')
await build({ configFile: false, root: path.join(repo, 'scripts/local-tasks-verify'), base: './', plugins: [react()], logLevel: 'warn',
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')),
    '@': path.join(core, 'ui/src/renderer-react'), 'moss-core-embedded-view': path.join(core, 'ui/src/renderer-react/components/embedded-app-view.tsx'),
    'moss-core-global-style': styles,
  } }, css: { postcss: { plugins: [requireCore('@tailwindcss/postcss')()] } }, build: { outDir: path.dirname(shell), emptyOutDir: true } })

const names = process.argv.includes('--app') ? [process.argv[process.argv.indexOf('--app') + 1].replace(/^moss\./, '')] : ['backup', 'data-workbench', 'media-tools']
for (const name of names) {
  const id = 'moss.' + name, report = path.join(output, name), errors = [], checks = []
  await fs.mkdir(report, { recursive: true })
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'apps', name, 'app.moss.json'), 'utf8'))
  const archive = path.join(repo, 'artifacts', id, manifest.version, `${id}-${manifest.version}-darwin-arm64.zip`)
  const desktop = await electron.launch({ executablePath: path.join(core, 'ui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: [path.join(repo, 'scripts/engine-apps-verify/desktop.cjs')], env: { ...process.env, MOSS_CORE_ROOT: core, MOSS_TEST_APP: id,
      MOSS_TEST_VERSION: manifest.version, MOSS_TEST_NODE: process.execPath, MOSS_TEST_SHELL: shell, MOSS_TEST_ARCHIVE: archive,
      MOSS_TEST_APP_UI_SCHEME: '1' }, timeout: 60000 })
  let page, directory
  try {
    const shellPage = await desktop.firstWindow()
    await expect(shellPage.locator('webview')).toBeVisible({ timeout: 30000 })
    const isApp = item => item.url().startsWith('moss-app://')
    page = desktop.context().pages().find(isApp) || await desktop.context().waitForEvent('page', { predicate: isApp, timeout: 30000 })
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(15000)
    directory = await desktop.evaluate(() => globalThis.localTaskFixture.directory)
    const invoke = (action, input = {}) => desktop.evaluate((_event, args) => globalThis.localTaskFixture.invoke(...args), [action, input])
    const pick = paths => desktop.evaluate((_event, value) => globalThis.localTaskFixture.pick(value), paths)
    const click = async locator => {
      await expect(locator).toBeVisible(); await expect(locator).toBeEnabled()
      await locator.scrollIntoViewIfNeeded()
      const box = await locator.boundingBox()
      await desktop.evaluate((_event, point) => globalThis.localTaskFixture.click(point), { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) })
    }
    const enter = async (locator, value) => {
      await locator.focus(); await locator.evaluate(element => element.select())
      await desktop.evaluate((_event, text) => globalThis.localTaskFixture.insertText(text), value)
      await expect(locator).toHaveValue(value)
    }
    const waitTask = async (key, value) => {
      let found
      await expect.poll(async () => { found = (await invoke('workspace.get')).tasks.find(task => task.input[key] === value); return found?.status }, { timeout: 120000, intervals: [300, 700, 1200] }).toBe('succeeded')
      return found
    }
    const runSkill = async input => {
      const skill = (await desktop.evaluate(() => globalThis.localTaskFixture.skills(true))).skills[0]
      const request = path.join(directory, 'skill-request.json')
      await fs.writeFile(request, JSON.stringify(input))
      const { execFileSync } = await import('node:child_process')
      return JSON.parse(execFileSync(skill.nodeExecutable, [...skill.nodeArgs, skill.cliPath, '--data-dir', skill.dataDir, 'run', '--input-file', request],
        { encoding: 'utf8', env: { ...process.env, ...skill.env }, timeout: 120000 }))
    }
    const screenshot = async suffix => fs.writeFile(path.join(report, suffix + '.png'), Buffer.from(await desktop.evaluate(() => globalThis.localTaskFixture.screenshot()), 'base64'))
    const resetScreenshotView = async () => {
      await expect(page.locator('.result-panel .badge')).toHaveText('已完成')
      await page.evaluate(() => { window.scrollTo(0, 0); document.scrollingElement?.scrollTo(0, 0) })
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      await page.waitForTimeout(200)
    }
    await expect(page.locator('main')).toBeVisible({ timeout: Number(process.env.MOSS_TEST_MAIN_TIMEOUT || 60000) })
    await assertAppContentLayout(page, manifest)
    await assertAppWorkspaceLayout(page)
    await expect(shellPage.getByText(manifest.displayName, { exact: true })).toHaveCount(1)
    checks.push('Moss outer frame and compact workspace layout')
    const agentTools = await desktop.evaluate(() => globalThis.localTaskFixture.tools(true))
    assert(agentTools.tools.length >= 6)
    await desktop.evaluate(() => globalThis.localTaskFixture.invokeTool('catalog', {}))
    if (name !== 'backup') assert.equal((await desktop.evaluate(() => globalThis.localTaskFixture.skills(true))).skills.length, 1)
    checks.push('Agent tools and skill discovery')
    if (name === 'backup') {
      const repoDir = path.join(directory, 'repository'), source = path.join(directory, 'source'), target = path.join(directory, 'restore')
      await Promise.all([repoDir, source, target].map(dir => fs.mkdir(dir)))
      await fs.writeFile(path.join(source, 'note.txt'), 'backup UI proof\n')
      await enter(page.getByLabel('设置备份密码'), 'verification-password')
      await click(page.getByRole('button', { name: '保存密码' }))
      await enter(page.getByLabel('备份库路径'), repoDir)
      await expect(page.getByRole('button', { name: '初始化' })).toBeEnabled()
      await click(page.getByRole('button', { name: '初始化' })); await waitTask('command', 'init')
      await pick([source]); await click(page.locator('.path-section').getByRole('button', { name: '选择目录' }))
      await click(page.getByRole('button', { name: '开始备份' })); await waitTask('command', 'backup')
      await click(page.getByRole('button', { name: '查看快照' })); const snapshot = await waitTask('command', 'snapshots')
      await expect(page.locator('.data-table')).toContainText(snapshot.result.snapshots[0].short_id)
      await click(page.locator('.data-table').getByRole('button', { name: '选择' }).first())
      await enter(page.getByLabel('恢复目标目录'), target)
      await click(page.getByRole('button', { name: '恢复到目标目录' }))
      await waitTask('command', 'restore')
      const relativeSource = (await fs.realpath(source)).replace(/^\/+/, '')
      assert.equal(await fs.readFile(path.join(target, relativeSource, 'note.txt'), 'utf8'), 'backup UI proof\n')
      checks.push('UI configures vault, backs up, browses snapshot and restores real file')
      const raw = await desktop.evaluate((_event, input) => globalThis.localTaskFixture.invokeTool('run', input),
        { command: 'raw', args: ['-r', repoDir, 'snapshots', '--json'] })
      assert(raw.id)
      await expect.poll(async () => (await invoke('tasks.get', { id: raw.id })).status, { timeout: 120000 }).toBe('succeeded')
      const rawTask = await invoke('tasks.get', { id: raw.id })
      assert(rawTask.result.text.includes(snapshot.result.snapshots[0].id))
      assert.equal(rawTask.source, 'agent-tool')
      checks.push('Agent raw Restic tool lists the snapshot and shares its record')
    } else if (name === 'data-workbench') {
      const file = path.join(directory, 'rows.csv')
      await fs.writeFile(file, 'id,name\n1,甲\n2,乙\n')
      await pick([file]); await click(page.getByRole('button', { name: '选择文件' }))
      await click(page.getByRole('button', { name: '预览前 200 行' }))
      await waitTask('mode', 'preview')
      await expect(page.locator('.data-table')).toContainText('甲')
      await click(page.getByText('导出查询结果', { exact: true }))
      await page.getByLabel('导出格式').selectOption('parquet')
      await click(page.getByRole('button', { name: '导出文件' }))
      const exported = await waitTask('mode', 'export')
      assert((await fs.stat(exported.artifacts[0].path)).size > 0)
      await expect(page.locator('.result-panel')).not.toContainText('返回 0 行')
      checks.push('UI previews real CSV rows and exports Parquet')
      assert.equal(await page.evaluate(() => document.hidden), false, 'App page must remain visible during the Agent CLI task')
      const raw = await runSkill({ mode: 'raw', args: ['-c', "COPY (SELECT * FROM read_csv_auto('" + file.replaceAll("'", "''") + "')) TO '{output}' (FORMAT CSV)"], outputName: 'raw.csv' })
      assert.equal(raw.status, 'succeeded', raw.message)
      assert((await fs.readFile(raw.artifacts[0].path, 'utf8')).includes('甲'))
      await expect(page.locator('.history')).toContainText('Agent skill', { timeout: 25000 })
      checks.push('Agent raw DuckDB CLI exports rows and appears automatically in the visible page')
    } else {
      const binary = path.join(repo, 'apps/media-tools/dist/engines/ffmpeg/8.0.1/ffmpeg')
      const video = path.join(directory, 'sample.mp4')
      const { execFileSync } = await import('node:child_process')
      execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=2', '-c:v', 'libx264', video])
      await pick([video]); await click(page.getByRole('button', { name: '选择文件' }))
      await waitTask('mode', 'inspect')
      await expect(page.locator('video').first()).toBeVisible()
      await click(page.getByRole('button', { name: '裁剪视频' }))
      await waitTask('mode', 'trim')
      await expect(page.locator('.result-panel video')).toBeVisible()
      await expect.poll(() => page.locator('.result-panel video').evaluate(element => element.videoWidth), { timeout: 15000 }).toBeGreaterThan(0)
      checks.push('UI inspects, previews and trims real video')
      const raw = await runSkill({ mode: 'raw', args: ['-hide_banner', '-nostdin', '-y', '-i', video, '-vf', 'scale=160:90', '-an', '{output}'], outputName: 'scaled.mp4' })
      assert.equal(raw.status, 'succeeded', raw.message)
      assert((await fs.stat(raw.artifacts[0].path)).size > 0)
      await expect(page.locator('.history')).toContainText('Agent skill')
      checks.push('Agent raw FFmpeg CLI scales video and shares its record')
    }
    await resetScreenshotView()
    await screenshot('light')
    await desktop.evaluate(() => globalThis.localTaskFixture.theme('dark'))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await resetScreenshotView()
    await screenshot('dark')
    await desktop.evaluate(() => globalThis.localTaskFixture.resize({ width: 440, height: 900 }))
    await page.waitForTimeout(150)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await resetScreenshotView()
    await screenshot('narrow')
    checks.push('Light, dark and narrow layouts')
    assert.deepEqual(errors, [])
    await fs.writeFile(path.join(report, 'report.json'), JSON.stringify({ appId: id, checks, pageErrors: errors }, null, 2) + '\n')
    console.log(id + ': ' + checks.join('; '))
  } catch (error) {
    console.error('App page:', page?.url(), 'Page errors:', errors)
    if (page) console.error('App HTML:', (await page.content().catch(() => '')).slice(0, 3000))
    throw error
  } finally {
    await desktop.evaluate(() => globalThis.localTaskFixture.cleanup()).catch(() => {})
    await desktop.close()
    if (directory) await fs.rm(directory, { recursive: true, force: true })
  }
}
