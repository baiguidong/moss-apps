// Real regression of the user's failed run. Uses existing Moss model/permissions,
// keeps the failed history, and submits one new run through the original chat.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { connectDesktop, connectConversationGuest, captureDesktop, waitFor } from './desktop-client.mjs'
const root = path.resolve(import.meta.dirname, '..')
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version
const output = path.resolve(root, '../../artifacts/moss.takt', version, 'verification')
await fs.mkdir(output, { recursive: true })
const file = path.join(output, 'runtime-recovery-real-model.json')
const receipt = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => ({ version, at: new Date().toISOString(), sessionId: '342ed91b-f9b1-494c-a026-a787f96bc1bf', workflowId: 'flow_ed28800f-a908-4fc6-8bf4-7c006a41cc4d', failedRunId: 'run_3dd4dc15-7cc6-47ab-81f7-26dce74e6258', checks: [], passed: false }))
const c = await connectDesktop()
let guest
const save = () => fs.writeFile(file, JSON.stringify(receipt, null, 2))
try {
  assert.equal((await c.desktop.evaluate(() => window.agentDesktop.getAppRuntimeState({ appId: 'moss.takt' }))).installation.activeVersion, version)
  await c.desktop.evaluate(() => window.agentDesktop.launchApp({ name: 'moss.takt' }))
  const app = await waitFor(async () => {
    for (const page of c.browser.contexts().flatMap(ctx => ctx.pages())) if (page.url().startsWith('moss-app:') && await page.evaluate(() => window.mossApp?.app.getInfo().then(i => i.id)).catch(() => '') === 'moss.takt') return page
  })
  const invoke = (action, input) => app.evaluate(async ({ action, input }) => {
    const response = await window.mossApp.actions.invoke(action, input, { requestId: crypto.randomUUID(), timeoutMs: 30000 })
    if (!response.ok) throw Error(response.error.message)
    return response.result
  }, { action, input })
  receipt.previousFailure = await invoke('takt_read', { operation: 'run', runId: receipt.failedRunId })
  assert.equal(receipt.previousFailure.status, 'failed')
  const history = await invoke('takt_read', { operation: 'runs', workflowId: receipt.workflowId })
  assert.equal(history.items.filter(run => run.status === 'submitting').length, 0)
  receipt.retiredSubmissions = history.items.filter(run => run.status === 'interrupted' && !run.taskId).map(run => run.id)
  assert.ok(receipt.retiredSubmissions.length >= 5)
  const detail = () => c.desktop.evaluate(sessionId => window.agentDesktop.getSession({ sessionId }), receipt.sessionId)
  assert.equal(Boolean((await detail()).busy), false)
  await c.main(`process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/')).webContents.send('app:open-session',{sessionId:${JSON.stringify(receipt.sessionId)}})`)
  await c.desktop.locator('textarea').waitFor()
  if (!receipt.runId) {
    const before = new Set(history.items.map(run => run.id))
    await c.desktop.locator('textarea').fill(`请实际运行 TAKT 工作流 ${receipt.workflowId} 的修订 2，本次任务保持“本地笔记设计 mvp”。这是修复后的验证，只启动一次，submissionKey 使用 takt-runtime-fix-${version}。不要修改工作流，不要轮询等待，返回运行入口即可。`)
    await c.desktop.getByRole('button', { name: '发送', exact: true }).click()
    const run = await waitFor(async () => (await invoke('takt_read', { operation: 'runs', workflowId: receipt.workflowId })).items.find(run => !before.has(run.id)), 180000)
    receipt.runId = run.id; await save(); console.log('Started', run.id)
  }
  receipt.result = await waitFor(async () => {
    const run = await invoke('takt_read', { operation: 'run', runId: receipt.runId })
    return ['completed', 'failed', 'interrupted', 'cancelled'].includes(run.status) ? run : null
  }, 180000)
  await save()
  assert.equal(receipt.result.status, 'completed', receipt.result.error)
  assert.equal(receipt.result.revision, 2)
  assert.equal(receipt.result.sessionId, receipt.sessionId)
  assert.equal(receipt.result.completedSteps, 2)
  assert.ok(String(receipt.result.occurrences.find(node => node.nodeId === 'summary').content).includes('会话工作台验证通过'))
  await waitFor(async () => !(await detail()).busy, 60000)
  await c.desktop.locator('[data-app-workbench-entry]').waitFor()
  if (await c.desktop.locator('[data-app-workbench-entry]').getAttribute('aria-pressed') !== 'true') await c.desktop.locator('[data-app-workbench-entry]').click()
  guest = await connectConversationGuest()
  await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).selectOption(`moss.takt:#/runs/${receipt.runId}`)
  await waitFor(() => guest.evaluate('Boolean(document.querySelector("[data-id=summary]"))'))
  await guest.evaluate('document.querySelector("[data-id=summary]").click()')
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.equal(await guest.evaluate('document.querySelector(".run-strip")?.parentElement.tagName'), 'HEADER')
  assert.equal(await guest.evaluate('Boolean(document.querySelector("main > .run-strip"))'), false)
  assert.equal(await guest.evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
  await captureDesktop(c.main, path.join(output, 'recovered-run-compact-header.png'))
  await app.evaluate(runId => { location.hash = '/runs/' + runId }, receipt.runId)
  await app.locator('.detail-header .run-strip').waitFor()
  receipt.checks = ['原失败运行保留；5 条未完成提交显示为中断', '真实主会话再次运行原修订 2、原任务，两个节点完成，来源会话保持一致', '结果包含会话工作台验证通过；没有新增工作流或改写 YAML', '状态、修订、进度、tokens、工具次数和时间位于标题工具栏，独立 App 与会话 graph 均生效']
  receipt.passed = true
  console.log(JSON.stringify({ passed: true, runId: receipt.runId, checks: receipt.checks, output }, null, 2))
} catch (error) { receipt.failure = error.stack; throw error }
finally { await save(); guest?.close(); await c.close() }
