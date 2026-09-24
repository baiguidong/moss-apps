import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEmbeddedShell } from './build-embedded-shell.mjs'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const repo = resolve(appRoot, '../..')
const core = process.env.MOSS_CORE_ROOT, deploy = process.env.MOSS_DRIVE_TEST_DEPLOY
if (!core || !deploy) throw new Error('Set MOSS_CORE_ROOT and MOSS_DRIVE_TEST_DEPLOY to the local Core checkout and test deployment')
const manifest = JSON.parse(await readFile(join(appRoot, 'app.moss.json'), 'utf8'))
const reportDir = join(repo, 'artifacts/moss.drive/verification', manifest.version)
await mkdir(reportDir, { recursive: true })
const shell = await buildEmbeddedShell(core, join(reportDir, 'embedded-shell'))
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
const desktop = await electron.launch({
  executablePath: process.env.MOSS_TEST_ELECTRON || join(core, 'ui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: [join(appRoot, 'scripts/desktop-fixture.cjs')],
  env: { ...process.env, MOSS_TEST_NODE: process.execPath, MOSS_DRIVE_TEST_SHELL: shell, MOSS_DRIVE_ARCHIVE: join(repo, 'artifacts/moss.drive', manifest.version, `moss.drive-${manifest.version}.zip`) }, timeout: 60_000,
})
const errors = []
let failed = false, temporary
try {
  const shellPage = await desktop.firstWindow({ timeout: 60_000 })
  await expect(shellPage.locator('webview')).toBeVisible({ timeout: 30_000 })
  const isDrive = page => page.url().includes('/dist/ui/index.html')
  let page = desktop.context().pages().find(isDrive) || await desktop.context().waitForEvent('page', { predicate: isDrive, timeout: 30_000 })
  page.on('pageerror', error => errors.push(error.message))
  const fixture = await desktop.evaluate(() => ({ folderName: globalThis.driveFixture.folderName, sourceName: globalThis.driveFixture.sourceName }))
  temporary = await desktop.evaluate(() => globalThis.driveFixture.temporary)
  const passed = async message => { console.log(`PASS ${message}`); await desktop.evaluate((_electron, message) => { globalThis.driveFixture.checks.push(message) }, message) }
  // Capture Electron's composited surface without changing guest viewport metrics.
  const screenshot = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const png = await desktop.evaluate(() => globalThis.driveFixture.screenshot())
    await writeFile(join(reportDir, name), Buffer.from(png, 'base64'))
  }
  await expect(page.getByText('服务运行中', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('浏览器演示', { exact: true })).toHaveCount(0)
  // The real root may span multiple pages; do not assume our new folder is in the first page.
  for (let i = 0; i < 100 && !await page.getByRole('button', { name: fixture.folderName, exact: true }).count(); i++) {
    const more = page.getByRole('button', { name: '加载更多', exact: true })
    if (!await more.count()) break
    await more.click(); await expect(more).toBeEnabled().catch(() => {})
  }
  await page.getByRole('button', { name: fixture.folderName, exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有文件' })).toBeVisible()
  await passed('Real server directory navigation and empty folder')
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  const createDialog = page.getByRole('dialog', { name: '新建目录' })
  await createDialog.getByRole('textbox', { name: '目录名称' }).fill('资料')
  await screenshot('create-folder.png')
  await createDialog.getByRole('button', { name: '创建', exact: true }).click()
  await expect(createDialog).toHaveCount(0)
  assert.ok((await desktop.evaluate(() => globalThis.driveFixture.remoteFiles())).some(file => file.kind === 'folder' && file.name === '资料'))
  await page.getByRole('button', { name: '资料', exact: true }).click()
  await expect(page.getByRole('heading', { name: '还没有文件' })).toBeVisible()
  await page.getByRole('button', { name: fixture.folderName, exact: true }).click()
  await page.getByRole('button', { name: '新建目录', exact: true }).click()
  await createDialog.getByRole('textbox').fill('资料')
  await createDialog.getByRole('button', { name: '创建', exact: true }).click()
  await expect(createDialog.getByRole('alert')).toContainText('同名')
  await createDialog.getByRole('button', { name: '取消', exact: true }).click()
  await passed('Directory creation reaches the real server, supports navigation and explains name conflicts')
  await page.getByRole('button', { name: '上传文件', exact: true }).first().click()
  let taskRow = page.getByTestId('transfer-row').filter({ hasText: fixture.sourceName }).first()
  await page.getByRole('button', { name: `暂停 ${fixture.sourceName}`, exact: true }).click()
  await expect(taskRow.getByText('已暂停', { exact: true })).toBeVisible()
  await expect(page.getByTestId('transfer-row').filter({ hasText: 'readme.txt' })).toBeVisible()
  await desktop.evaluate(() => globalThis.driveFixture.waitWorkers())
  await desktop.evaluate(() => globalThis.driveFixture.restartHost())
  // Core's refresh recreates the guest. Reattach Playwright to its new target.
  const reopened = desktop.context().waitForEvent('page', { predicate: candidate => candidate !== shellPage && candidate !== page, timeout: 30_000 })
  await shellPage.getByRole('button', { name: '刷新', exact: true }).click()
  page = await reopened
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForURL(isDrivePage => isDrivePage.pathname.endsWith('/dist/ui/index.html'))
  await expect(page.getByText('服务运行中', { exact: true })).toBeVisible({ timeout: 30_000 })
  taskRow = page.getByTestId('transfer-row').filter({ hasText: fixture.sourceName }).first()
  await page.getByRole('tab', { name: '上传', exact: true }).click()
  await expect(taskRow.getByText('上次退出时已暂停，可继续传输。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: `继续 ${fixture.sourceName}`, exact: true }).click()
  await expect(taskRow.getByText('已完成', { exact: true })).toBeVisible({ timeout: 90_000 })
  await page.getByRole('tab', { name: '全部文件', exact: true }).click()
  await page.getByRole('button', { name: fixture.folderName, exact: true }).click()
  await expect(page.getByRole('button', { name: `下载 ${fixture.sourceName}`, exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: '下载 readme.txt', exact: true })).toBeVisible()
  await passed('Multi-file upload, pause, Host restart, history restoration and explicit resume')
  await desktop.evaluate(() => globalThis.driveFixture.setCancelSave(true))
  const taskCount = await desktop.evaluate(() => globalThis.driveFixture.transferCount())
  const savePickCount = await desktop.evaluate(() => globalThis.driveFixture.savePickCount())
  await page.getByRole('button', { name: `下载 ${fixture.sourceName}`, exact: true }).click()
  await expect.poll(() => desktop.evaluate(() => globalThis.driveFixture.savePickCount())).toBe(savePickCount + 1)
  await expect(page.getByRole('button', { name: `下载 ${fixture.sourceName}`, exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  assert.equal(await desktop.evaluate(() => globalThis.driveFixture.transferCount()), taskCount)
  await expect(page.getByRole('tab', { name: '全部文件', exact: true })).toHaveAttribute('aria-selected', 'true')
  await desktop.evaluate(() => globalThis.driveFixture.setCancelSave(false))
  await page.getByRole('button', { name: `下载 ${fixture.sourceName}`, exact: true }).click()
  const downloads = page.getByTestId('transfer-row').filter({ has: page.getByLabel('下载', { exact: true }) })
  await expect(downloads.getByText('已完成', { exact: true })).toBeVisible({ timeout: 90_000 })
  const hashes = await desktop.evaluate(() => globalThis.driveFixture.hashes())
  assert.equal(hashes.source, hashes.download)
  await passed('Native-dialog cancellation contract and real download SHA-256 match (35 MiB + 101 B)')
  await expect(page.getByTestId('transfer-announcement')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '下载', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('transfer-row')).toHaveCount(1)
  await screenshot('downloads.png')
  await page.getByRole('tab', { name: '上传', exact: true }).click()
  await expect(page.getByTestId('transfer-row')).toHaveCount(2)
  await screenshot('uploads.png')
  await page.getByRole('tab', { name: '全部文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '资料', exact: true })).toBeVisible()
  await passed('Top-level file/upload/download tabs separate records and preserve the directory')
  await screenshot('desktop.png')
  const layout = await page.evaluate(() => {
    const area = document.querySelector('.file-scroll').getBoundingClientRect()
    const rows = [...document.querySelectorAll('[data-testid="file-row"]')].map(row => row.getBoundingClientRect())
    return { listHeight: area.height, viewportHeight: innerHeight, footerBottom: document.querySelector('.workspace-footer').getBoundingClientRect().bottom, rowsFit: rows.every(row => row.bottom <= area.bottom), titleCount: [...document.querySelectorAll('h1')].filter(el => el.getBoundingClientRect().width > 2).length }
  })
  const container = await shellPage.evaluate(() => {
    const guest = document.querySelector('webview').getBoundingClientRect()
    return { viewportHeight: innerHeight, guestHeight: guest.height, guestTop: guest.top, guestBottom: guest.bottom }
  })
  assert.ok(container.guestBottom <= container.viewportHeight + 1)
  assert.ok(layout.footerBottom + container.guestTop <= container.viewportHeight + 1)
  assert.ok(layout.listHeight > layout.viewportHeight * 0.65)
  assert.equal(layout.rowsFit, true)
  assert.equal(layout.titleCount, 0)
  await passed('Core embedded container has one visible title; file list uses over 65% of available height')
  await page.getByRole('button', { name: `下载 ${fixture.sourceName}`, exact: true }).click()
  const existsError = '保存位置已有同名文件，请重新下载并选择其他名称。'
  await expect(page.getByText(existsError, { exact: true })).toBeVisible({ timeout: 60_000 })
  const failedDownload = page.getByTestId('transfer-row').filter({ hasText: existsError })
  await failedDownload.getByRole('button', { name: `取消 ${fixture.sourceName}`, exact: true }).click()
  await expect(failedDownload).toHaveCount(0)
  const preserved = await desktop.evaluate(() => globalThis.driveFixture.hashes())
  assert.equal(preserved.download, hashes.download)
  await passed('Existing download destination is preserved; EEXIST is explained and failed task can cancel')
  await page.getByRole('tab', { name: '全部文件', exact: true }).click()
  await desktop.evaluate(() => globalThis.driveFixture.setPicker('one'))
  await page.getByRole('button', { name: '上传文件', exact: true }).first().click()
  await expect(page.getByText('此目录已有同名文件，请调整文件名后重新上传。', { exact: true })).toBeVisible({ timeout: 30_000 })
  const paused = page.getByTestId('transfer-row').filter({ hasText: '此目录已有同名文件' })
  await paused.getByRole('button', { name: `取消 ${fixture.sourceName}`, exact: true }).click()
  await expect(paused).toHaveCount(0)
  await expect(page.getByText('Moss 尚未确认取消结果，可稍后重试取消。', { exact: true })).toBeVisible({ timeout: 30_000 })
  await passed('Duplicate upload never overwrites; Core cancellation uncertainty stays visible with retry')
  await page.getByRole('tab', { name: '全部文件', exact: true }).click()
  await desktop.evaluate(() => globalThis.driveFixture.setPicker('cancel'))
  await page.getByRole('button', { name: '上传文件', exact: true }).first().click()
  await desktop.evaluate(() => globalThis.driveFixture.waitUploadInitialized('cancel.bin'))
  await page.getByRole('button', { name: '暂停 cancel.bin', exact: true }).click()
  await desktop.evaluate(() => globalThis.driveFixture.waitWorkers())
  await page.getByRole('button', { name: '取消 cancel.bin', exact: true }).click()
  await expect(page.getByTestId('transfer-row').filter({ hasText: 'cancel.bin' }).getByText('已取消', { exact: true })).toBeVisible({ timeout: 30_000 })
  await passed('An initialized upload cancels through the real server and reaches final cancelled state')
  await page.getByRole('tab', { name: '全部文件', exact: true }).click()
  const beforeDelete = await desktop.evaluate(() => ({ requests: globalThis.driveFixture.deleteRequestCount() }))
  const quotaBefore = await desktop.evaluate(() => globalThis.driveFixture.quota())
  await page.getByRole('button', { name: '删除 readme.txt', exact: true }).click()
  const deleteDialog = page.getByRole('dialog', { name: '删除文件' })
  await expect(deleteDialog.getByText('readme.txt', { exact: true })).toBeVisible()
  await deleteDialog.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await desktop.evaluate(() => globalThis.driveFixture.deleteRequestCount()), beforeDelete.requests)
  await expect(page.getByRole('button', { name: '下载 readme.txt', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '删除 readme.txt', exact: true }).click()
  await screenshot('delete-file.png')
  await deleteDialog.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(deleteDialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '下载 readme.txt', exact: true })).toHaveCount(0)
  assert.equal((await desktop.evaluate(() => globalThis.driveFixture.remoteFiles())).some(file => file.name === 'readme.txt'), false)
  assert.equal(await desktop.evaluate(() => globalThis.driveFixture.deleteRequestCount()), beforeDelete.requests + 1)
  await expect.poll(async () => (await desktop.evaluate(() => globalThis.driveFixture.quota())).usedBytes).toBe(quotaBefore.usedBytes - 25)
  await passed('File deletion requires confirmation, uses the delete grant, removes the server file and releases quota')
  await desktop.evaluate(() => globalThis.driveFixture.disable())
  await expect(page.getByRole('heading', { name: '尚未连接服务器' })).toBeVisible()
  await expect(page.getByTestId('file-row')).toHaveCount(0)
  await expect(page.getByTestId('transfer-row')).toHaveCount(0)
  await passed('Remote connection change clears files, path, quota and transfers')
  assert.deepEqual(errors, [])
  const result = await desktop.evaluate(() => globalThis.driveFixture.report())
  assert.ok(result.progressEvents > 0)
  await writeFile(join(reportDir, 'desktop-report.json'), `${JSON.stringify({ at: new Date().toISOString(), ...result, hashes, layout: { ...layout, container }, rendererErrors: errors, limitations: ['Picker selections are deterministic test responses; native dialog visuals were not automated.', 'Mounts the actual Core EmbeddedAppView and webview in an isolated runtime; the current Moss main window is unchanged.', 'Core leaves cancellation unconfirmed after a rejected duplicate upload; the UI displays the real state and offers retry.'] }, null, 2)}\n`)
} catch (error) {
  failed = true
  console.error(error)
  const diagnostics = await desktop.evaluate(() => globalThis.driveFixture?.report()).catch(() => null)
  await writeFile(join(reportDir, 'failure.json'), `${JSON.stringify({ error: String(error), diagnostics, rendererErrors: errors }, null, 2)}\n`)
  const pages = desktop.windows()
  if (pages[0]) await pages[0].screenshot({ path: join(reportDir, 'failure.png') }).catch(() => {})
  throw error
} finally {
  try { await desktop.evaluate(() => globalThis.driveFixture?.cleanup()) }
  catch (error) { if (!failed) throw error; console.error('Fixture cleanup also failed:', error.message) }
  finally {
    await desktop.close()
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}
