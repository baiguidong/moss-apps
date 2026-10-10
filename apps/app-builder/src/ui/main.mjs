import { createAppClient } from '@moss/app-sdk/ui'
const $ = id => document.getElementById(id)
const client = window.mossApp ? createAppClient(window.mossApp) : null
function notice(text, error = false) { $('notice').hidden = !text; $('notice').className = error ? 'error' : ''; $('notice').textContent = text }
const inspect = (operation, input = {}) => client.actions.invoke('builder_inspect', { operation, ...input })
async function busy(button, work) {
  button.disabled = true
  try { await work() } catch (error) { notice(error.message || String(error), true) } finally { button.disabled = false }
}
function cards(container, items, title, description, label, action) {
  container.replaceChildren()
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty muted'; empty.textContent = container.id === 'projects' ? '还没有项目。创建第一个 App，或从下面选择已有 App 开始迭代。' : '尚未安装其他 App。'; container.append(empty); return }
  for (const item of items) {
    const card = document.createElement('article'); card.className = 'card'
    const content = document.createElement('div'); content.className = 'card-content'
    const heading = document.createElement('h3'); heading.textContent = title(item)
    const detail = document.createElement('p'); detail.className = 'muted'; detail.textContent = description(item)
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = label
    button.addEventListener('click', () => busy(button, () => action(item)))
    content.append(heading, detail); card.append(content, button); container.append(card)
  }
}
async function refresh() {
  const [info, apps, projects] = await Promise.all([inspect('info'), inspect('apps'), inspect('projects')])
  const methods = await client.host.request('moss.host/v1', 'capabilities.get', { protocols: ['moss.apps/v1'] })
  if (methods.capabilities.some(method => !method.supported)) throw new Error('请更新 Moss 后使用 应用构建。')
  cards($('apps'), apps.items.filter(app => app.appId !== 'moss.app-builder'), item => item.displayName, item => item.packageStatus === 'ready' ? `版本 ${item.version}` : '需要检查源码与兼容性', '迭代', async item => {
    const target = await inspect('target', { appId: item.appId })
    await client.host.request('moss.apps/v1', 'authoring.prepare', { intent: 'edit', targetRef: target.targetRef })
    notice('已在会话中准备好迭代需求。')
  })
  $('project-count').textContent = `${projects.items.length} 个项目`
  cards($('projects'), projects.items, item => item.title || item.appId, item => item.baseVersion ? `当前基准 ${item.baseVersion}` : '尚未安装', '继续', async item => {
    await client.composer.prepare({ providerId: 'projects', intent: 'edit', ref: { projectRef: item.projectRef } })
    notice('已打开项目会话。')
  })
  const appearance = (await client.app.getInfo())?.appearance
  const dark = appearance?.themeMode === 'dark' || (appearance?.themeMode === 'system' && matchMedia('(prefers-color-scheme:dark)').matches)
  document.documentElement.classList.toggle('dark', Boolean(dark))
  document.documentElement.classList.toggle('light', appearance?.themeMode === 'light')
  return info
}
if (!client) { notice('请在 Moss 中打开 应用构建。', true); $('submit').disabled = true; $('refresh').disabled = true }
else {
  const draft = await client.storage.getItem('requirements').catch(() => null)
  if (draft) $('requirements').value = draft
  $('requirements').addEventListener('input', () => { void client.storage.setItem('requirements', $('requirements').value).catch(() => {}) })
  $('create').addEventListener('submit', event => {
    event.preventDefault()
    void busy($('submit'), async () => {
      const prompt = $('requirements').value.trim(), skillPath = $('skill').value.trim()
      if (!prompt) return
      await client.host.request('moss.apps/v1', 'authoring.prepare', { intent: 'create', prompt, ...(skillPath ? { ref: { skillPath } } : {}) })
      notice('需求已准备好，请在会话中发送。')
    })
  })
  $('refresh').addEventListener('click', () => busy($('refresh'), refresh))
  client.events.on('appearance', () => { void refresh().catch(error => notice(error.message, true)) })
  client.events.on('runtime', () => { void refresh().catch(error => notice(error.message, true)) })
  await refresh().catch(error => notice(error.message, true))
  window.addEventListener('pagehide', () => client.dispose(), { once: true })
}
