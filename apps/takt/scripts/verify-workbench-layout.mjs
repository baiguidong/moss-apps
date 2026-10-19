// Read-only desktop regression, except preparing (not sending) a node draft.
// Requires authorization to interact with the running Moss and resize its window.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { connectDesktop, connectConversationGuest, captureDesktop, waitFor } from './desktop-client.mjs'
const root = path.resolve(import.meta.dirname, '..'), version = JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version
const output = path.resolve(root, '../../artifacts/moss.takt', version, 'verification')
await fs.mkdir(output, { recursive: true })
const exampleVersion = process.env.TAKT_EXAMPLE_VERSION || version
const example = JSON.parse(await fs.readFile(path.resolve(output, '../../', exampleVersion, 'verification/conversation-real-model.json')))
const c = await connectDesktop(), receipt = { version, at: new Date().toISOString(), checks: [], errors: [], passed: false }
let guest, bounds, theme
const nativeWindow = `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/'))`
const navigate = async sessionId => {
  guest?.close(); guest = null
  await c.main(`${nativeWindow}.webContents.send('app:open-session', {sessionId:${JSON.stringify(sessionId)}})`)
  await waitFor(async () => (await c.desktop.locator('[data-app-workbench-entry]').count()) > 0)
}
const open = async () => {
  if (await c.desktop.locator('[data-app-workbench-entry]').getAttribute('aria-pressed') !== 'true') await c.desktop.locator('[data-app-workbench-entry]').click()
  guest?.close(); guest = await connectConversationGuest()
}
const shot = name => captureDesktop(c.main, path.join(output, name + '.png'))
try {
  bounds = await c.main(`${nativeWindow}.getBounds()`)
  theme = await c.desktop.evaluate(async () => (await window.agentDesktop.getSettings()).appearance)
  await navigate(example.sessionId); await open()
  await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).selectOption(`moss.takt:#/runs/${example.runId}`)
  await waitFor(() => guest.evaluate('Boolean(document.querySelector("[data-id=summary]"))'))
  await guest.evaluate('document.querySelector("[data-id=summary]").click()')
  await waitFor(() => guest.evaluate('Boolean(document.querySelector(".inspector"))'))
  await shot('final-conversation-node')
  // Exercise the real Host appearance notification, then restore the preference.
  await c.desktop.evaluate(() => window.agentDesktop.updateSettings({ appearance: { themeMode: 'dark' } }))
  await waitFor(() => guest.evaluate('document.documentElement.dataset.theme === "dark" && document.querySelector(".react-flow.dark") !== null'))
  await guest.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await shot('conversation-dark')
  await c.desktop.evaluate(theme => window.agentDesktop.updateSettings({ appearance: { themeMode: theme.themeMode } }), theme)
  const minimum = await c.main(`${nativeWindow}.getMinimumSize()`), narrowWidth = Math.max(1040, minimum[0])
  await c.main(`${nativeWindow}.setBounds({width:${narrowWidth},height:800})`)
  await waitFor(() => c.desktop.evaluate(width => innerWidth <= width, narrowWidth))
  await guest.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await c.desktop.locator('textarea').isVisible(), true)
  assert.equal(await guest.evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
  const button = await c.desktop.locator('[data-app-workbench-entry]').boundingBox()
  assert.ok(button.x + button.width <= await c.desktop.evaluate(() => innerWidth))
  await shot('conversation-compact')
  receipt.checks.push(`完整图和节点详情、深色样式及 ${narrowWidth}px 最小窗口原生截图；窄屏输入框和顶部入口可见、App 无横向溢出`)
  await c.main(`${nativeWindow}.setBounds(${JSON.stringify(bounds)})`)
  await c.desktop.evaluate(() => window.agentDesktop.launchApp({ name: 'moss.takt' }))
  const app = await waitFor(async () => {
    for (const page of c.browser.contexts().flatMap(context => context.pages())) if (page.url().startsWith('moss-app:') && await page.evaluate(() => window.mossApp?.app.getInfo().then(info => info.id)).catch(() => '') === 'moss.takt') return page
  })
  app.on('pageerror', error => receipt.errors.push(error.message))
  await app.evaluate(id => { location.hash = '/flows/' + id }, example.workflowId)
  await app.getByRole('button', { name: '编辑', exact: true }).click()
  assert.ok((await app.getByRole('textbox', { name: '工作流 YAML', exact: true }).inputValue()).includes('initial_step: ideas'))
  await app.getByRole('button', { name: '关闭编辑器', exact: true }).click()
  receipt.checks.push('已有工作流的 YAML 编辑仍可打开和关闭，未保存修改')
  const invoke = (action, input) => app.evaluate(async ({ action, input }) => { const r = await window.mossApp.actions.invoke(action, input, { requestId: crypto.randomUUID() }); if (!r.ok) throw Error(r.error.message); return r.result }, { action, input })
  const loop = await invoke('takt_read', { operation: 'run', runId: 'run_46fb6b9e-928e-4460-8dbe-e641be8fb968' })
  await navigate(loop.sessionId); await open()
  await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).selectOption(`moss.takt:#/runs/${loop.id}`)
  await waitFor(() => guest.evaluate('Boolean(document.querySelector("[data-id=revise]"))'))
  await guest.evaluate('document.querySelector("[data-id=revise]").click()')
  await waitFor(() => guest.evaluate('Boolean(document.querySelector(".inspector select"))'))
  for (const [index, text] of ['需要修改：请补充验证步骤', '验收通过：已补充验证步骤'].entries()) {
    await guest.evaluate(`(()=>{const s=document.querySelector('.inspector select');s.selectedIndex=${index};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await waitFor(async () => (await guest.evaluate('document.querySelector(".inspector").innerText')).includes(text))
    await shot(`conversation-loop-${index + 1}`)
  }
  await c.desktop.evaluate(() => { window.__taktLayoutPrepared = null; window.__taktLayoutOff = window.agentDesktop.onAppPrepareComposer(v => { window.__taktLayoutPrepared = v }) })
  await guest.evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("讨论此节点")).click()')
  const prepared = await waitFor(() => c.desktop.evaluate(() => window.__taktLayoutPrepared))
  assert.equal(prepared.sessionId, loop.sessionId)
  assert.equal(prepared.context.ref.occurrenceId, 'revise:2')
  await c.desktop.locator('textarea').fill('') // Clear only this test's unsent draft.
  receipt.checks.push('会话图查看既有两轮真实返工；第二轮讨论引用确认为 revise:2，未重新执行')
  assert.deepEqual(guest.errors, [])
  await navigate(example.sessionId); await open()
  await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).selectOption(`moss.takt:#/runs/${example.runId}`)
  await waitFor(() => guest.evaluate('Boolean(document.querySelector("[data-id=summary]"))'))
  await guest.evaluate('document.querySelector("[data-id=summary]").click()')
  await guest.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await shot('final-conversation-node')
  await c.main(`${nativeWindow}.focus()`)
  assert.deepEqual(receipt.errors, [])
  receipt.passed = true
  console.log(JSON.stringify(receipt, null, 2))
} catch (error) { receipt.failure = error.stack; throw error }
finally {
  await c.desktop.evaluate(async theme => { if (theme) await window.agentDesktop.updateSettings({ appearance: { themeMode: theme.themeMode } }); window.__taktLayoutOff?.(); delete window.__taktLayoutOff; delete window.__taktLayoutPrepared }, theme).catch(() => {})
  if (bounds) await c.main(`${nativeWindow}.setBounds(${JSON.stringify(bounds)})`).catch(() => {})
  await fs.writeFile(path.join(output, 'workbench-layout.json'), JSON.stringify(receipt, null, 2))
  guest?.close(); await c.close()
}
