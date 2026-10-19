// Runs real model turns in the user's running Moss. Requires explicit testing
// authorization. Leaves named sessions, workflows and results for inspection.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { connectDesktop, connectConversationGuest, captureDesktop, waitFor } from './desktop-client.mjs'

const root = path.resolve(import.meta.dirname, '..')
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
const output = path.resolve(root, '../../artifacts/moss.takt', version, 'verification')
await fs.mkdir(output, { recursive: true })
const file = path.join(output, 'conversation-real-model.json')
const receipt = process.env.TAKT_RESUME === '1' ? JSON.parse(await fs.readFile(file, 'utf8')) : { version, at: new Date().toISOString(), checks: [], errors: [], passed: false }
const c = await connectDesktop()
let guest
const save = () => fs.writeFile(file, JSON.stringify(receipt, null, 2))
const check = async message => { receipt.checks.push(message); console.log(message); await save() }
const shot = name => captureDesktop(c.main, path.join(output, name + '.png'))
const button = text => guest.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button');b.click();return true})()`)
const open = async () => {
  if (await c.desktop.locator('[data-app-workbench-entry]').getAttribute('aria-pressed') !== 'true') await c.desktop.locator('[data-app-workbench-entry]').click()
  guest?.close(); guest = await connectConversationGuest()
}
const detail = id => c.desktop.evaluate(sessionId => window.agentDesktop.getSession({ sessionId }), id)
const selectSession = async title => {
  guest?.close(); guest = null
  await c.desktop.getByText(title, { exact: true }).first().click()
  await c.desktop.locator('textarea').waitFor()
}
const send = async (id, prompt, wait = true) => {
  const before = (await detail(id)).history.length
  await c.desktop.locator('textarea').fill(prompt)
  await c.desktop.getByRole('button', { name: '发送', exact: true }).click()
  await waitFor(async () => (await detail(id)).history.length > before, 30000)
  if (wait) await waitFor(async () => { const d = await detail(id); return !d.busy && d.history.length > before ? d : null }, 240000)
}
try {
  c.desktop.on('pageerror', error => receipt.errors.push(error.message))
  const installed = await c.desktop.evaluate(() => window.agentDesktop.getAppRuntimeState({ appId: 'moss.takt' }))
  assert.equal(installed.installation.activeVersion, version)
  await c.desktop.evaluate(() => window.agentDesktop.launchApp({ name: 'moss.takt' }))
  const appPage = await waitFor(async () => {
    for (const page of c.browser.contexts().flatMap(context => context.pages())) {
      if (page.url().startsWith('moss-app:') && await page.evaluate(() => window.mossApp?.app.getInfo().then(info => info.id)).catch(() => '') === 'moss.takt') return page
    }
  })
  const invoke = (action, input = {}) => appPage.evaluate(async ({ action, input }) => {
    const r = await window.mossApp.actions.invoke(action, input, { requestId: crypto.randomUUID(), timeoutMs: 30000 })
    if (!r.ok) throw new Error(r.error.message)
    return r.result
  }, { action, input })
  const runCount = async () => (await invoke('takt_read', { operation: 'runs' })).total
  if (!receipt.naturalCreation) {
    await appPage.evaluate(() => { location.hash = '/' })
    await appPage.locator('.new-card').waitFor()
    const sessions = (await c.desktop.evaluate(() => window.agentDesktop.listSessions())).length, runs = await runCount()
    for (const entry of [appPage.getByRole('button', { name: '新建工作流', exact: true }).first(), appPage.getByRole('button', { name: '新建工作流', exact: true }).last(), appPage.locator('.new-card')]) {
      await entry.click()
      await waitFor(async () => (await c.desktop.locator('textarea').inputValue()).includes('创建一个工作流'))
      assert.equal(await appPage.getByRole('dialog', { name: '编辑工作流' }).count(), 0)
      assert.equal(await appPage.getByRole('textbox', { name: '工作流 YAML' }).count(), 0)
    }
    assert.equal((await c.desktop.evaluate(() => window.agentDesktop.listSessions())).length, sessions)
    assert.equal(await runCount(), runs)
    await shot('natural-language-create')
    receipt.naturalCreation = true
    await check('App 顶部/侧栏/从一句话开始三个新建入口均准备自然语言草稿，不打开 YAML 编辑器，不自动创建会话或执行')
  }
  if (!receipt.existingDiscussion) {
    await selectSession('TAKT 验证 · 对话修改、运行与查询')
    await open()
    assert.equal(await c.desktop.locator('textarea').isVisible(), true)
    await guest.evaluate('document.querySelector("[data-id=summarize]").click()')
    await waitFor(() => guest.evaluate('Boolean(document.querySelector(".inspector"))'))
    await guest.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await guest.evaluate(`document.querySelector('[aria-label="Zoom In"]').click()`)
    const transform = await guest.evaluate('document.querySelector(".react-flow__viewport").style.transform'), guestId = guest.id
    await c.desktop.getByRole('button', { name: '返回聊天', exact: true }).click()
    await open()
    assert.equal(guest.id, guestId)
    assert.equal(await guest.evaluate('document.querySelector(".react-flow__viewport").style.transform'), transform)
    assert.ok((await guest.evaluate('document.querySelector(".inspector").innerText')).includes('对话运行验证通过'))
    await check('顶部入口打开运行图；主输入框一直可见；图↔聊天保留同一 guest、缩放与节点选择')
    const beforeRuns = await runCount(), beforeSessions = (await c.desktop.evaluate(() => window.agentDesktop.listSessions())).length
    await c.desktop.evaluate(() => { window.__taktPrepared = null; window.__taktPrepareOff = window.agentDesktop.onAppPrepareComposer(value => { window.__taktPrepared = value }) })
    await button('在会话中讨论此节点')
    const prepared = await waitFor(() => c.desktop.evaluate(() => window.__taktPrepared))
    receipt.prepared = prepared
    assert.equal(prepared.sessionId, '843b7d26-d893-421d-afa7-47350456cc03')
    assert.ok(JSON.stringify(prepared).includes('summarize:1'))
    assert.equal(await c.desktop.locator('[data-app-workbench-entry]').getAttribute('aria-pressed'), 'false')
    assert.equal(await runCount(), beforeRuns)
    assert.equal((await c.desktop.evaluate(() => window.agentDesktop.listSessions())).length, beforeSessions)
    await shot('node-discussion-draft')
    await send(prepared.sessionId, '请读取刚刚选中的节点执行引用，只回答这个节点结果的最后一句是什么。不要修改、创建或运行工作流。')
    const history = (await detail(prepared.sessionId)).history
    assert.ok(JSON.stringify(history.slice(-8)).includes('对话运行验证通过'))
    assert.equal(await runCount(), beforeRuns)
    receipt.existingDiscussion = true
    await check('点击节点讨论仅准备同一会话草稿，带 workflow/revision/run/node/occurrence；实际发送后模型读到对应结果，无新运行')
  }
  if (!receipt.sessionId) {
    receipt.sessionTitle = `TAKT 验证 · 会话工作台 · ${version}`
    const created = await c.desktop.evaluate(title => window.agentDesktop.createSession({ title, agentMode: 'local', appIds: ['moss.takt'] }), receipt.sessionTitle)
    receipt.sessionId = created.summary.id
    await save()
  }
  await selectSession(receipt.sessionTitle)
  if (!receipt.workflowId) {
    const beforeRuns = await runCount()
    await send(receipt.sessionId, `请实际使用 TAKT 工作流 App 创建并保存名为「验证 · 会话工作台 · ${version}」的工作流，先不要运行。只有两个顺序 Agent 节点：ideas（提出 3 个本地待办 App 功能）、summary（汇总为不超过 120 字建议），然后 COMPLETE。Agent 只做文字分析，不调用工具、不读写文件。请先读取 App 示例以确保 YAML 格式有效，保存后返回 workflowId 和 revision，简短回复即可。`)
    const flows = await invoke('takt_read', { operation: 'list', query: `验证 · 会话工作台 · ${version}` })
    assert.equal(flows.items.length, 1)
    receipt.workflowId = flows.items[0].id
    assert.equal(flows.items[0].revision, 1)
    assert.equal(await runCount(), beforeRuns)
    await open()
    assert.ok((await guest.evaluate('document.body.innerText')).includes('在会话中运行'))
    await shot('definition-preview')
    await check('真实对话生成并保存工作流，顶部出现定义预览；未请求运行时不执行')
  }
  if (!receipt.edited) {
    if (await c.desktop.locator('[data-app-workbench-entry]').getAttribute('aria-pressed') === 'true') await c.desktop.locator('[data-app-workbench-entry]').click()
    const beforeRuns = await runCount()
    await send(receipt.sessionId, '请修改刚创建的这一个工作流：保留两个步骤，在 summary 的输出最后一行加上“会话工作台验证通过”。保存为新修订，先不要运行。')
    const flow = await invoke('takt_read', { operation: 'get', workflowId: receipt.workflowId })
    assert.equal(flow.revision, 2)
    assert.equal(await runCount(), beforeRuns)
    await open()
    const options = await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).locator('option').allTextContents()
    assert.ok(options.some(o => o.includes('修订 1')) && options.some(o => o.includes('修订 2')), options.join('\n'))
    receipt.edited = true
    await check('对话修改生成修订 2，修订 1 / 2 均能独立预览，无新运行')
  }
  if (!receipt.runId) {
    await open()
    await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).selectOption(`moss.takt:#/flows/${receipt.workflowId}?revision=2`)
    await waitFor(async () => (await guest.evaluate('document.querySelector(".run-strip")?.innerText || ""')).includes('修订 2'))
    await button('在会话中运行')
    await waitFor(async () => (await c.desktop.locator('textarea').inputValue()).includes('请运行'))
    await send(receipt.sessionId, `请运行选中的修订 2 工作流。本次任务：为本地个人待办 App 提出 3 项 MVP 功能，然后汇总。各步骤只用简短文字分析，不调用工具，不读写文件。只运行一次，返回运行入口即可，不要轮询。`, false)
    const run = await waitFor(async () => (await invoke('takt_read', { operation: 'runs' })).items.find(r => r.workflowId === receipt.workflowId), 180000)
    receipt.runId = run.id
    await save()
  }
  if (!receipt.completed) {
    await waitFor(async () => (await c.desktop.locator('[data-app-workbench-entry]').count()) > 0)
    await open()
    await waitFor(async () => (await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).locator('option').evaluateAll(options => options.map(o => o.value))).includes(`moss.takt:#/runs/${receipt.runId}`))
    await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).selectOption(`moss.takt:#/runs/${receipt.runId}`)
    await waitFor(async () => (await guest.evaluate('location.hash')).includes(receipt.runId))
    await waitFor(() => guest.evaluate('Boolean([...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="暂停"))'))
    await button('暂停')
    await waitFor(async () => (await invoke('takt_read', { operation: 'run', runId: receipt.runId })).status === 'paused', 180000)
    await shot('run-paused')
    await waitFor(() => guest.evaluate('Boolean([...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="继续"))'))
    await button('继续')
    const result = await waitFor(async () => { const run = await invoke('takt_read', { operation: 'run', runId: receipt.runId }); return ['completed','failed','cancelled','interrupted'].includes(run.status) ? run : null }, 300000)
    receipt.result = result
    assert.equal(result.status, 'completed', result.error)
    assert.equal(result.completedSteps, 2)
    assert.ok(JSON.stringify(result.occurrences.find(o => o.nodeId === 'summary')?.content).includes('会话工作台验证通过'))
    assert.ok(JSON.stringify(result).includes(receipt.sessionId), 'Run must retain the same conversation source')
    receipt.completed = true
    await check('从预览准备运行草稿，经主输入框发送后绑定当前会话；内嵌图暂停/继续有效，真实模型完成两步并留下指定结果')
  }
  await open()
  await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).selectOption(`moss.takt:#/runs/${receipt.runId}`)
  await waitFor(() => guest.evaluate('Boolean(document.querySelector("[data-id=summary]"))'))
  await guest.evaluate('document.querySelector("[data-id=summary]").click()')
  await shot('conversation-completed-node')
  assert.deepEqual(guest.errors, [])
  await selectSession('TAKT 验证 · 对话修改、运行与查询')
  await open()
  assert.ok(!(await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).innerText()).includes(receipt.version))
  await selectSession(receipt.sessionTitle)
  await open()
  assert.ok(!(await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).innerText()).includes('验证 · 对话生成'))
  await check('切换会话不混入其他会话的运行；返回后保留所选工作流记录')
  const original = await c.desktop.evaluate(() => window.agentDesktop.getAppRuntimeState({ appId: 'moss.workflow' }))
  assert.equal(original.installation.enabled, true)
  receipt.originalWorkflow = original.installation.activeVersion
  assert.deepEqual(receipt.errors, [])
  receipt.passed = true
  await check('原工作流 App 保留并启用；主窗口及工作流 guest 无未捕获异常')
} catch (error) {
  receipt.failure = error.stack
  await shot('conversation-failure').catch(() => {})
  throw error
} finally {
  await c.desktop.evaluate(() => { window.__taktPrepareOff?.(); delete window.__taktPrepareOff; delete window.__taktPrepared }).catch(() => {})
  await save(); guest?.close(); await c.close()
}
