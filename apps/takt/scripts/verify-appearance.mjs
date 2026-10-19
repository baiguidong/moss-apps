// Uses the running user's Moss with explicit UI-testing authorization.
// Changes only appearance during verification and restores it in finally.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { connectDesktop, connectConversationGuest, captureDesktop, waitFor } from './desktop-client.mjs'
const root = path.resolve(import.meta.dirname, '..'), version = JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version
const output = path.resolve(root, '../../artifacts/moss.takt', version, 'verification')
await fs.mkdir(output, { recursive: true })
const example = JSON.parse(await fs.readFile(path.resolve(output, '../../0.3.1/verification/conversation-real-model.json')))
const c = await connectDesktop(), receipt = { version, at: new Date().toISOString(), checks: [], combinations: [], errors: [], passed: false }
let guest, app, original
const snapshot = `(()=>{const r=document.documentElement,canvas=document.querySelector('.canvas'),probe=document.createElement('span');probe.style.cssText='position:fixed;visibility:hidden;pointer-events:none';document.body.append(probe);const color=name=>{probe.style.color='var(--'+name+')';return getComputedStyle(probe).color};const colors={bg:color('bg'),text:color('text'),primary:color('accent')};probe.remove();return {mode:r.dataset.theme,preset:r.dataset.backgroundStyle,...colors,image:getComputedStyle(canvas).backgroundImage,size:getComputedStyle(canvas).backgroundSize,graphMode:document.querySelector('.react-flow')?.className,selected:document.querySelector('.react-flow__node.selected')?.dataset.id,viewport:document.querySelector('.react-flow__viewport')?.style.transform}})()`
// Wait for Core's color transitions before capturing native Electron surfaces.
const settle = () => new Promise(resolve => setTimeout(resolve, 500))
try {
  original = await c.desktop.evaluate(async () => (await window.agentDesktop.getSettings()).appearance)
  receipt.originalAppearance = original
  await fs.writeFile(path.join(output, 'appearance-original.json'), JSON.stringify(original, null, 2))
  c.desktop.on('pageerror', e => receipt.errors.push(e.message))
  const installed = await c.desktop.evaluate(() => window.agentDesktop.getAppRuntimeState({ appId: 'moss.takt' }))
  assert.equal(installed.installation.activeVersion, version)
  await c.desktop.getByRole('button', { name: '设置', exact: true }).click()
  const presetButton = c.desktop.getByRole('button', { name: 'TAKT 苔绿', exact: true })
  await presetButton.scrollIntoViewIfNeeded()
  await presetButton.click()
  await waitFor(async () => await presetButton.getAttribute('aria-pressed') === 'true')
  assert.equal((await c.desktop.evaluate(() => window.agentDesktop.getSettings())).appearance.cssThemeId, 'takt-theme')
  assert.equal(await presetButton.evaluate(button => { const label = button.querySelector('span.block.whitespace-nowrap'); return label && label.scrollWidth <= label.clientWidth }), true)
  for (const [mode, label] of [['light', '浅色'], ['dark', '暗色']]) {
    await c.desktop.getByRole('button', { name: label, exact: true }).click()
    await waitFor(async () => (await c.desktop.evaluate(() => window.agentDesktop.getSettings())).appearance.themeMode === mode)
    await settle()
    await captureDesktop(c.main, path.join(output, `settings-takt-${mode}.png`))
  }
  receipt.checks.push('通过实际设置页选择 TAKT 苔绿，名称完整显示，选中状态与持久化设置一致')
  await c.desktop.evaluate(() => window.agentDesktop.launchApp({ name: 'moss.takt' }))
  app = await waitFor(async () => {
    for (const page of c.browser.contexts().flatMap(ctx => ctx.pages())) if (page.url().startsWith('moss-app:') && await page.evaluate(() => window.mossApp?.app.getInfo().then(i => i.id)).catch(() => '') === 'moss.takt') return page
  })
  app.on('pageerror', e => receipt.errors.push(e.message))
  await app.evaluate(runId => { location.hash = '/runs/' + runId }, example.runId)
  await app.locator('[data-id=summary]').click()
  await c.main(`process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/')).webContents.send('app:open-session',{sessionId:${JSON.stringify(example.sessionId)}})`)
  await c.desktop.locator('[data-app-workbench-entry]').waitFor()
  if (await c.desktop.locator('[data-app-workbench-entry]').getAttribute('aria-pressed') !== 'true') await c.desktop.locator('[data-app-workbench-entry]').click()
  guest = await connectConversationGuest()
  await c.desktop.getByRole('combobox', { name: '选择会话中的工作流' }).selectOption(`moss.takt:#/runs/${example.runId}`)
  await waitFor(() => guest.evaluate('Boolean(document.querySelector("[data-id=summary]"))'))
  await guest.evaluate('document.querySelector("[data-id=summary]").click()')
  await guest.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const before = await guest.evaluate(snapshot), guestId = guest.id
  for (const preset of ['default','grid-theme','dot-theme','gradient-theme','takt-theme']) {
    for (const mode of ['light','dark']) {
      const saved = await c.desktop.evaluate(appearance => window.agentDesktop.updateSettings({ appearance }), { themeMode: mode, cssThemeId: preset })
      assert.equal(saved.appearance.cssThemeId, preset)
      await waitFor(async () => {
        const standalone = await app.evaluate(({ mode, preset }) => document.documentElement.dataset.theme === mode && document.documentElement.dataset.backgroundStyle === preset, { mode, preset })
        const embedded = await guest.evaluate(`document.documentElement.dataset.theme === '${mode}' && document.documentElement.dataset.backgroundStyle === '${preset}'`)
        return standalone && embedded
      })
      await settle()
      const core = await c.desktop.evaluate(() => { const probe=document.createElement('span');probe.style.cssText='position:fixed;visibility:hidden;pointer-events:none';document.body.append(probe);const color=name=>{probe.style.color='var(--'+name+')';return getComputedStyle(probe).color};const colors={bg:color('background'),text:color('foreground'),primary:color('primary')};probe.remove();return {mode:document.documentElement.dataset.theme,...colors} })
      const embedded = await guest.evaluate(snapshot), standalone = await app.evaluate(snapshot)
      assert.equal(core.mode, mode)
      for (const view of [embedded, standalone]) {
        assert.equal(view.bg, core.bg); assert.equal(view.text, core.text); assert.equal(view.primary, core.primary)
        assert.ok(view.graphMode.split(' ').includes(mode))
        assert.equal(view.selected, 'summary')
        if (preset === 'default') assert.equal(view.image, 'none')
        else assert.ok(view.image.includes(preset === 'grid-theme' || preset === 'gradient-theme' ? 'linear-gradient' : 'radial-gradient'))
      }
      assert.equal(embedded.viewport, before.viewport)
      receipt.combinations.push({ preset, mode, core, embedded })
      if (preset === 'takt-theme' || preset === 'grid-theme' && mode === 'light') await captureDesktop(c.main, path.join(output, `${preset}-${mode}.png`))
      if (preset === 'takt-theme') {
        await c.desktop.locator('[data-app-workbench-entry]').click()
        await settle()
        await captureDesktop(c.main, path.join(output, `chat-takt-${mode}.png`))
        await c.desktop.locator('[data-app-workbench-entry]').click()
        await waitFor(() => guest.evaluate('Boolean(document.querySelector("[data-id=summary]"))'))
      }
    }
  }
  receipt.checks.push('5 种背景 × 明暗两种模式：Core、独立 App、会话 guest 的配色与风格一致，实时更新，无需刷新')
  receipt.checks.push('切换风格保留节点选择、缩放和同一 guest；ReactFlow 明暗模式随 Host 通知更新')
  assert.equal(guest.id, guestId)
  await app.reload()
  await app.locator('[data-id=summary]').waitFor()
  assert.equal(await app.evaluate(() => document.documentElement.dataset.backgroundStyle), 'takt-theme')
  assert.equal((await c.desktop.evaluate(() => window.agentDesktop.getSettings())).appearance.cssThemeId, 'takt-theme')
  receipt.checks.push('TAKT 预设真实保存，重新打开 App 仍读取同一设置')
  await c.desktop.evaluate(() => window.agentDesktop.updateSettings({ appearance: { themeMode: 'system' } }))
  for (const mode of ['dark', 'light']) {
    await app.emulateMedia({ colorScheme: mode })
    await waitFor(() => app.evaluate(mode => document.documentElement.dataset.theme === mode && document.querySelector('.react-flow')?.classList.contains(mode), mode))
  }
  await app.emulateMedia({ colorScheme: null })
  receipt.checks.push('跟随系统在系统明暗变化后更新 App 和 graph')
  assert.deepEqual(receipt.errors, []); assert.deepEqual(guest.errors, [])
  receipt.passed = true
} catch (error) { receipt.failure = error.stack; throw error }
finally {
  if (app) await app.emulateMedia({ colorScheme: null }).catch(() => {})
  if (original) await c.desktop.evaluate(appearance => window.agentDesktop.updateSettings({ appearance }), original)
  receipt.restoredAppearance = await c.desktop.evaluate(async () => (await window.agentDesktop.getSettings()).appearance).catch(() => null)
  await fs.writeFile(path.join(output, 'appearance-real-desktop.json'), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify({ passed: receipt.passed, checks: receipt.checks, failure: receipt.failure, output }, null, 2))
  guest?.close(); await c.close()
}
