// Requires authorization to install and test in the user's running development Moss.
// All test workflows remain; no model calls are made by this regression script.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDesktop, waitFor } from './desktop-client.mjs'
const appRoot = fileURLToPath(new URL('..', import.meta.url)), repo = path.resolve(appRoot, '../..')
const version = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8')).version
const output = path.join(repo, 'artifacts/moss.takt', version, 'verification')
await fs.mkdir(output, { recursive: true })
const { browser, desktop, main, close } = await connectDesktop()
const receipt = { version, at: new Date().toISOString(), passed: false, checks: [], retained: [], errors: [] }
let appPage
const state = appId => desktop.evaluate(async appId => {
  const s = await window.agentDesktop.getAppRuntimeState({ appId })
  return { appId, version: s.installation?.activeVersion, enabled: s.installation?.enabled }
}, appId)
try {
  const originalWorkflow = await state('moss.workflow')
  const archive = path.join(repo, 'artifacts/moss.takt', version, `moss.takt-${version}.zip`)
  await main(`(() => { const electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'); const dialog=electron.dialog; globalThis.__taktInstallDialogs={dialog,open:dialog.showOpenDialog,box:dialog.showMessageBox}; dialog.showOpenDialog=async options=>options?.title==='Install Moss App'?{canceled:false,filePaths:[${JSON.stringify(archive)}]}:globalThis.__taktInstallDialogs.open.call(dialog,options); dialog.showMessageBox=async options=>options?.title==='安装 Moss App'&&options?.message?.includes('TAKT 工作流')?{response:1}:globalThis.__taktInstallDialogs.box.call(dialog,options);return true })()`)
  try {
    const installed = await desktop.evaluate(() => window.agentDesktop.installAppArchive())
    assert.equal(installed.ok, true, JSON.stringify(installed))
  } finally { await main(`(() => { const s=globalThis.__taktInstallDialogs;if(s){s.dialog.showOpenDialog=s.open;s.dialog.showMessageBox=s.box;delete globalThis.__taktInstallDialogs;}return true })()`) }
  await desktop.evaluate(() => window.agentDesktop.launchApp({ name: 'moss.takt' }))
  appPage = await waitFor(async () => {
    for (const page of browser.contexts().flatMap(c => c.pages())) if (page.url().startsWith('moss-app:') && await page.evaluate(() => window.mossApp?.app.getInfo().then(i => i.id)).catch(() => '') === 'moss.takt') return page
  })
  appPage.on('pageerror', error => receipt.errors.push(error.message))
  const invoke = async (action, input = {}) => {
    const response = await appPage.evaluate(async ({ action, input }) => window.mossApp.actions.invoke(action, input, { requestId: crypto.randomUUID(), timeoutMs: 30000 }), { action, input })
    if (!response.ok) throw new Error(response.error.message)
    return response.result
  }
  const go = async route => { await appPage.evaluate(route => { location.hash = route }, route); await waitFor(async () => !(await appPage.locator('[role="alert"]').count())) }
  const screenshot = name => appPage.screenshot({ path: path.join(output, name + '.png') })
  const flowId = async previous => waitFor(async () => { const hash = await appPage.evaluate(() => location.hash); const id = hash.startsWith('#/flows/') && hash.split('/').at(-1); return id && id !== previous ? id : null })
  receipt.installed = await state('moss.takt')
  assert.equal(receipt.installed.version, version)
  assert.equal(receipt.installed.enabled, true)
  receipt.checks.push('真实 Desktop ZIP 安装与源码验证完成，新版本已启用')

  await appPage.setViewportSize({ width: 1280, height: 850 })
  await go('#/')
  const fixtureTitle = '验证 · 目录与修订 · ' + Date.now().toString().slice(-6)
  const yaml = await fs.readFile(path.join(appRoot, 'resources/example.yaml'), 'utf8')
  await appPage.getByLabel('导入 YAML 文件').setInputFiles({ name: fixtureTitle + '.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yaml) })
  const importedId = await flowId()
  receipt.retained.push({ workflowId: importedId, title: fixtureTitle })
  await appPage.getByRole('button', { name: '编辑', exact: true }).click()
  await appPage.getByRole('textbox', { name: '工作流 YAML', exact: true }).fill(yaml.replace('max_steps: 12', 'max_steps: 10'))
  await appPage.getByRole('button', { name: '保存工作流', exact: true }).click()
  await waitFor(async () => (await invoke('takt_read', { operation: 'get', workflowId: importedId })).revision === 2)
  await appPage.getByRole('button', { name: '修订历史', exact: true }).click()
  const versions = appPage.getByRole('dialog', { name: '修订历史', exact: true })
  await screenshot('revisions')
  await versions.locator('.version-row').filter({ hasText: '修订 1' }).getByRole('button', { name: '查看', exact: true }).click()
  await appPage.locator('.revision-notice').filter({ hasText: '正在查看历史修订 1，最新为 2。' }).waitFor()
  await appPage.getByRole('button', { name: '将此内容保存为新修订', exact: true }).click()
  await waitFor(async () => (await invoke('takt_read', { operation: 'get', workflowId: importedId })).revision === 3)
  const restored = await invoke('takt_read', { operation: 'get', workflowId: importedId })
  assert.equal(restored.yaml, yaml)
  receipt.checks.push('页面导入 YAML、编辑保存 r2、查看 r1、恢复旧内容为 r3；旧修订保留')

  await appPage.getByRole('button', { name: '复制工作流', exact: true }).click()
  const copyId = await flowId(importedId)
  assert.equal((await invoke('takt_read', { operation: 'get', workflowId: copyId })).yaml, yaml)
  await appPage.getByRole('button', { name: '归档工作流', exact: true }).click()
  await waitFor(async () => (await invoke('takt_read', { operation: 'get', workflowId: copyId })).archived)
  assert.ok(!(await invoke('takt_read', { operation: 'list' })).items.some(f => f.id === copyId))
  await appPage.getByLabel('显示归档', { exact: true }).check()
  const copy = await invoke('takt_read', { operation: 'get', workflowId: copyId })
  await appPage.locator('.workflow-card').filter({ hasText: copy.title }).click()
  await appPage.getByRole('button', { name: '恢复工作流', exact: true }).click()
  await waitFor(async () => !(await invoke('takt_read', { operation: 'get', workflowId: copyId })).archived)
  receipt.retained.push({ workflowId: copyId, title: copy.title })
  receipt.checks.push('页面复制、归档、显示归档及恢复；副本独立')

  await go('#/flows/' + importedId)
  await appPage.getByRole('button', { name: '编辑', exact: true }).waitFor()
  const countBeforeDraft = (await invoke('takt_read', { operation: 'list' })).total
  await appPage.getByRole('button', { name: '新建工作流', exact: true }).first().click()
  const draft = desktop.locator('textarea').last()
  await waitFor(async () => (await draft.inputValue()).includes('创建一个工作流'))
  assert.equal(await appPage.getByRole('textbox', { name: '工作流 YAML', exact: true }).count(), 0)
  assert.equal((await invoke('takt_read', { operation: 'get', workflowId: importedId })).revision, 3)
  assert.equal((await invoke('takt_read', { operation: 'list' })).total, countBeforeDraft)
  receipt.checks.push('详情页新建准备自然语言草稿，不打开 YAML、不修改原流程、不自动保存')
  await draft.fill('') // Remove only the unsent draft created by this test.
  await appPage.getByRole('button', { name: '对话修改', exact: true }).click()
  await waitFor(async () => (await draft.inputValue()).includes(fixtureTitle))
  receipt.preparedDraft = await draft.inputValue()
  await draft.fill('')
  receipt.checks.push('对话修改按钮仍准备已有工作流的固定修订引用和未发送草稿')
  await invoke('takt_archive', { workflowId: copyId, archived: true })

  const history = await invoke('takt_read', { operation: 'runs', limit: 50 })
  const loop = history.items.find(r => r.title === '验证 · 条件返工两轮' && r.status === 'completed')
  assert.ok(loop, '先保留一次真实模型条件返工验证')
  await go('#/runs/' + loop.id)
  await appPage.locator('[data-id="revise"]').click()
  await appPage.getByText('需要修改', { exact: true }).waitFor()
  await appPage.getByRole('combobox', { name: /执行次数/ }).selectOption({ index: 0 })
  await appPage.getByText('需要修改：请补充验证步骤', { exact: true }).waitFor()
  await screenshot('loop-first')
  await appPage.getByRole('combobox', { name: /执行次数/ }).selectOption({ index: 1 })
  await appPage.getByText('验收通过：已补充验证步骤', { exact: true }).waitFor()
  const loopLabel = await appPage.locator('.loop-label').boundingBox(), canvas = await appPage.locator('.canvas').boundingBox()
  assert.ok(loopLabel.x >= canvas.x && loopLabel.x + loopLabel.width <= canvas.x + canvas.width)
  await screenshot('loop-second')
  await appPage.getByRole('button', { name: '完整事件记录', exact: true }).click()
  const events = appPage.getByRole('dialog', { name: '完整事件记录', exact: true })
  await events.locator('details').first().locator('summary').click()
  await screenshot('events')
  await appPage.getByRole('button', { name: '关闭事件记录', exact: true }).click()
  receipt.checks.push('升级后真实模型两轮历史仍可查看；返工连线与标签可见，每轮输出可切换，事件可展开')

  const parallel = history.items.find(r => r.title === '验证 · 分析与双路审查 · 0.2.0' && r.status === 'completed')
  assert.ok(parallel)
  await go('#/runs/' + parallel.id)
  await appPage.locator('[data-id="summarize"]').click()
  await screenshot('parallel')
  await appPage.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark' })
  await screenshot('dark')
  await appPage.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.colorScheme = 'light' })
  await appPage.setViewportSize({ width: 740, height: 780 })
  assert.equal(await appPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await screenshot('compact')
  await appPage.setViewportSize({ width: 1280, height: 850 })
  await appPage.reload()
  await appPage.locator('[data-id="summarize"]').click()
  assert.equal((await invoke('takt_read', { operation: 'run', runId: parallel.id })).completedSteps, 5)
  receipt.checks.push('升级保留并行完成记录与结果；深浅色、窄屏和刷新验证')
  assert.deepEqual(await state('moss.workflow'), originalWorkflow)
  receipt.originalWorkflow = originalWorkflow
  receipt.checks.push('原 moss.workflow 的已安装版本和启用状态保持一致')
  assert.deepEqual(receipt.errors, [])
  receipt.passed = true
  console.log(JSON.stringify({ passed: true, checks: receipt.checks, retained: receipt.retained, output }, null, 2))
} catch (error) {
  receipt.failure = error.stack
  if (appPage) await appPage.screenshot({ path: path.join(output, 'regression-failure.png') }).catch(() => {})
  throw error
} finally {
  await fs.writeFile(path.join(output, 'desktop-regression.json'), JSON.stringify(receipt, null, 2))
  await close()
}
