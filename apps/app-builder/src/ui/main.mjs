import { createAppClient } from '@moss/app-sdk/ui'
const $ = id => document.getElementById(id)
const client = window.mossApp ? createAppClient(window.mossApp) : null
const key = item => `${item.kind}:${item.name}`
const title = item => item.displayName || item.name
const kindLabel = kind => kind === 'skill' ? '技能' : '助手'
const paths = {
  blocks: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7m-3.5-3.5v7"/>',
  skill: '<path d="m15 12-8.4 8.4a2 2 0 0 1-3-3L12 9m-3-3 3-3 3 1 5 5 1 3-3 3-3-3-3-3Z"/>',
  assistant: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4H9M1 12v4m22-4v4m-15-3h.01M16 13h.01M9 17h6"/>',
  filter: '<path d="M4 7h16M7 12h10m-7 5h4"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>',
}
function icon(name) {
  const node = document.createElement('span')
  node.setAttribute('aria-hidden', 'true')
  node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.blocks}</svg>`
  return node
}
for (const node of document.querySelectorAll('[data-icon]')) node.replaceChildren(icon(node.dataset.icon))
function element(tag, className, text) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function notice(text, error = false) { $('notice').hidden = !text; $('notice').className = error ? 'error' : ''; $('notice').textContent = text }
const inspect = (operation, input = {}) => client.actions.invoke('builder_inspect', { operation, ...input })
async function busy(button, work) {
  button.disabled = true
  try { await work() } catch (error) { notice(error.message || String(error), true) } finally { button.disabled = false }
}
let resources = [], selected = [], resourceState = 'loading', resourceError = '', pendingResources
let activeTab = 'skill', mentionTab = 'skill', mention = null, mentionIndex = 0, submitting = false
let persistQueue = Promise.resolve()
function persist() {
  if (!client) return
  const draft = { requirements: $('requirements').value, resources: selected.map(({ kind, name, displayName }) => ({ kind, name, displayName })) }
  persistQueue = persistQueue.catch(() => {}).then(() => client.storage.setItem('creation-draft', draft)).catch(() => {})
}
function filtered(kind, query) {
  const normalized = query.trim().toLocaleLowerCase('zh-Hans-CN')
  return resources.filter(item => item.kind === kind && [item.name, item.displayName, item.description].some(value => String(value || '').toLocaleLowerCase('zh-Hans-CN').includes(normalized)))
}
function updateSubmit() { $('submit').disabled = !client || submitting || (!$('requirements').value.trim() && !selected.length) }
function renderSelected() {
  $('selected-resources').replaceChildren(...selected.map(item => {
    const button = element('button', 'resource-chip'); button.type = 'button'
    button.dataset.resourceKey = key(item)
    const unavailable = resourceState === 'ready' && !resources.some(resource => key(resource) === key(item))
    button.setAttribute('aria-label', `移除${kindLabel(item.kind)}：${title(item)}`)
    button.title = unavailable ? '资源已停用或卸载，请移除后重新选择' : `移除${kindLabel(item.kind)}：${title(item)}`
    button.append(icon(item.kind), element('span', 'chip-title', `${title(item)}${unavailable ? '（不可用）' : ''}`), icon('close'))
    button.addEventListener('click', () => { selected = selected.filter(value => key(value) !== key(item)); selectionChanged() })
    return button
  }))
  $('selected-resources').hidden = !selected.length
  $('selection-count').textContent = selected.length
  $('selection-count').hidden = !selected.length
  $('choose-resources').setAttribute('aria-label', selected.length ? `选择资源，已选 ${selected.length} 项` : '选择资源')
  updateSubmit()
}
function selectionChanged() { renderSelected(); renderPicker(); renderMentions(); persist() }
function selectResource(item, toggle = true) {
  const exists = selected.some(value => key(value) === key(item))
  if (exists) { if (toggle) selected = selected.filter(value => key(value) !== key(item)) }
  else {
    const next = item.kind === 'assistant' ? selected.filter(value => value.kind !== 'assistant') : selected
    if (next.length >= 20) { notice('最多选择 20 个技能或助手。', true); return false }
    selected = [...next, item]
  }
  selectionChanged()
  return true
}
function resourceRow(item, { index, mentionRow = false } = {}) {
  const chosen = selected.some(value => key(value) === key(item))
  const button = element('button', 'resource-row'); button.type = 'button'; button.dataset.resourceKey = key(item)
  if (mentionRow) { button.id = `mention-${index}`; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', index === mentionIndex); button.tabIndex = -1 }
  else button.setAttribute('aria-pressed', chosen)
  const avatar = element('span', 'resource-icon')
  if (/^(https?:|data:image\/)/i.test(item.icon || '')) {
    const image = document.createElement('img'); image.alt = ''; image.src = item.icon
    image.addEventListener('error', () => avatar.replaceChildren(icon(item.kind)), { once: true }); avatar.append(image)
  } else if (item.emoji) avatar.textContent = item.emoji
  else avatar.append(icon(item.kind))
  const content = element('span', 'resource-body')
  content.append(element('span', 'resource-title', title(item)), element('span', 'resource-description', item.description || kindLabel(item.kind)))
  const check = element('span', `resource-check${item.kind === 'skill' && !mentionRow ? ' multiple' : ''}`)
  if (chosen) check.append(icon('check'))
  button.append(avatar, content, check)
  button.addEventListener('click', () => {
    if (mentionRow) chooseMention(item)
    else {
      selectResource(item)
      Array.from($('resource-results').querySelectorAll('button')).find(row => row.dataset.resourceKey === key(item))?.focus()
    }
  })
  // Keep the textarea caret while selecting an @ suggestion.
  if (mentionRow) button.addEventListener('mousedown', event => event.preventDefault())
  return button
}
function renderResults(container, items, mentionRows = false) {
  container.replaceChildren()
  if (resourceState !== 'ready' || !items.length) {
    container.append(element('p', 'empty muted', resourceState === 'loading' ? '正在加载技能和助手…' : resourceState === 'error' ? resourceError : '没有匹配的已安装资源'))
    if (resourceState === 'error') {
      const retry = element('button', 'ghost', '重试'); retry.type = 'button'; retry.addEventListener('click', () => void loadResources()); container.append(retry)
    }
  } else container.append(...items.map((item, index) => resourceRow(item, { index, mentionRow: mentionRows })))
}
function renderPicker() {
  const items = filtered(activeTab, $('resource-search').value)
  for (const tab of document.querySelectorAll('[data-resource-tab]')) { tab.setAttribute('aria-selected', tab.dataset.resourceTab === activeTab); tab.tabIndex = tab.dataset.resourceTab === activeTab ? 0 : -1 }
  $('resource-results').setAttribute('aria-labelledby', `tab-${activeTab}`)
  $('resource-search').placeholder = `搜索已安装${kindLabel(activeTab)}`
  $('picker-description').textContent = `选择创建 App 所需的技能和助手，已选 ${selected.length} 项`
  $('resource-total').textContent = $('resource-search').value.trim() ? `${items.length} 个结果` : `共 ${items.length} 个${kindLabel(activeTab)}`
  renderResults($('resource-results'), items)
}
async function loadResources() {
  if (pendingResources) return pendingResources
  resourceState = 'loading'; renderPicker(); renderMentions()
  pendingResources = (async () => {
    try {
      const result = await client.host.request('moss.apps/v1', 'authoring.resources', {})
      resources = result.items.filter(item => ['skill', 'assistant'].includes(item.kind))
      selected = selected.map(item => resources.find(value => key(value) === key(item)) || item)
      resourceState = 'ready'
    } catch (error) { resourceState = 'error'; resourceError = error.message || '资源加载失败，请重试。' }
    finally { pendingResources = null; renderPicker(); renderMentions(); renderSelected() }
  })()
  return pendingResources
}
function closeMentions() { mention = null; $('mentions').hidden = true; $('requirements').setAttribute('aria-expanded', 'false'); $('requirements').removeAttribute('aria-activedescendant') }
function updateMention() {
  const input = $('requirements'), before = input.value.slice(0, input.selectionStart)
  const match = before.match(/(?:^|\s)@([^\s@]*)$/u)
  if (!match || input.selectionStart !== input.selectionEnd) { closeMentions(); return }
  const start = input.selectionStart - match[1].length - 1
  if (!mention || mention.query !== match[1] || mention.start !== start) mentionIndex = 0
  mention = { start, end: input.selectionStart, query: match[1] }
  renderMentions()
}
function renderMentions() {
  if (!mention) return
  const items = filtered(mentionTab, mention.query)
  mentionIndex = Math.min(mentionIndex, Math.max(0, items.length - 1))
  $('mentions').hidden = false; $('requirements').setAttribute('aria-expanded', 'true')
  for (const tab of document.querySelectorAll('[data-mention-tab]')) tab.setAttribute('aria-selected', tab.dataset.mentionTab === mentionTab)
  renderResults($('mention-results'), items, true)
  if (items.length && resourceState === 'ready') { $('requirements').setAttribute('aria-activedescendant', `mention-${mentionIndex}`); $(`mention-${mentionIndex}`)?.scrollIntoView({ block: 'nearest' }) }
  else $('requirements').removeAttribute('aria-activedescendant')
}
function chooseMention(item) {
  if (!mention) return
  const range = mention
  if (!selectResource(item, false)) return
  const input = $('requirements')
  input.setRangeText('', range.start, range.end, 'end')
  closeMentions(); persist(); updateSubmit(); input.focus()
}
$('requirements').addEventListener('input', event => { persist(); updateSubmit(); if (!event.isComposing) updateMention() })
$('requirements').addEventListener('click', updateMention)
$('requirements').addEventListener('compositionend', updateMention)
$('requirements').addEventListener('keydown', event => {
  if (event.isComposing || !mention) return
  const items = filtered(mentionTab, mention.query)
  if (event.key === 'Escape') { event.preventDefault(); closeMentions() }
  else if (event.key === 'Tab') { event.preventDefault(); mentionTab = mentionTab === 'skill' ? 'assistant' : 'skill'; mentionIndex = 0; renderMentions() }
  else if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); mentionIndex = (mentionIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % (items.length || 1); renderMentions() }
  else if (event.key === 'Enter' && resourceState === 'ready' && items.length) { event.preventDefault(); chooseMention(items[mentionIndex]) }
})
$('requirements').addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateMention() })
for (const tab of document.querySelectorAll('[data-mention-tab]')) {
  tab.addEventListener('mousedown', event => event.preventDefault())
  tab.addEventListener('click', () => { mentionTab = tab.dataset.mentionTab; mentionIndex = 0; renderMentions(); $('requirements').focus() })
}
document.addEventListener('pointerdown', event => { if (!document.querySelector('.input-area').contains(event.target)) closeMentions() })
$('choose-resources').addEventListener('click', () => {
  closeMentions(); $('resource-search').value = ''; renderPicker(); $('resource-picker').showModal(); $('resource-search').focus(); void loadResources()
})
function closePicker() { $('resource-picker').close(); $('choose-resources').focus() }
$('close-picker').addEventListener('click', closePicker)
$('confirm-resources').addEventListener('click', closePicker)
$('resource-picker').addEventListener('click', event => { if (event.target === $('resource-picker')) { const rect = $('resource-picker').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePicker() } })
$('resource-search').addEventListener('input', renderPicker)
for (const tab of document.querySelectorAll('[data-resource-tab]')) {
  const activate = () => { activeTab = tab.dataset.resourceTab; $('resource-search').value = ''; renderPicker() }
  tab.addEventListener('click', activate)
  tab.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = document.querySelector(`[data-resource-tab="${activeTab === 'skill' ? 'assistant' : 'skill'}"]`); next.click(); next.focus() } })
}
async function refreshProjects() {
  const projects = await inspect('projects')
  $('project-count').textContent = `${projects.items.length} 个项目`
  $('projects').replaceChildren()
  if (!projects.items.length) $('projects').append(element('p', 'empty muted', '还没有项目，从上方创建你的第一个 App。'))
  for (const item of projects.items) {
    const row = element('article', 'project'), content = element('div', 'project-content')
    content.append(element('h3', '', item.title || item.appId), element('p', 'muted', item.baseVersion ? `当前版本 ${item.baseVersion}` : '尚未安装'))
    const button = element('button', 'ghost', '继续'); button.type = 'button'; button.append(icon('arrow'))
    button.addEventListener('click', () => busy(button, async () => { await client.composer.prepare({ providerId: 'projects', intent: 'edit', ref: { projectRef: item.projectRef } }); notice('已打开项目会话。') }))
    row.append(icon('blocks'), content, button); $('projects').append(row)
  }
}
const media = matchMedia('(prefers-color-scheme: dark)')
let appearance = { themeMode: 'system', cssThemeId: 'default' }
function applyAppearance(value = appearance) {
  appearance = { ...appearance, ...value }
  const theme = appearance.themeMode === 'system' ? media.matches ? 'dark' : 'light' : appearance.themeMode
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.backgroundStyle = appearance.cssThemeId || 'default'
  document.documentElement.style.colorScheme = theme
}
const systemChanged = () => applyAppearance()
media.addEventListener('change', systemChanged)
applyAppearance()
async function refreshAppearance() { applyAppearance((await client.app.getInfo())?.appearance) }
async function refresh() { await Promise.all([refreshProjects(), loadResources(), refreshAppearance()]) }
if (!client) { notice('请在 Moss 中打开应用构建。', true); $('refresh').disabled = true; $('choose-resources').disabled = true }
else {
  const draft = await client.storage.getItem('creation-draft').catch(() => null)
  const legacy = !draft ? await client.storage.getItem('requirements').catch(() => null) : null
  $('requirements').value = typeof draft?.requirements === 'string' ? draft.requirements : typeof legacy === 'string' ? legacy : ''
  selected = Array.isArray(draft?.resources) ? draft.resources.filter(item => item && ['skill', 'assistant'].includes(item.kind) && typeof item.name === 'string').slice(0, 20) : []
  $('create').addEventListener('submit', event => {
    event.preventDefault()
    if (submitting) return
    const prompt = $('requirements').value.trim()
    if (!prompt && !selected.length) return
    closeMentions(); submitting = true; updateSubmit(); notice('')
    void (async () => {
      try {
        await persistQueue
        await client.host.request('moss.apps/v1', 'authoring.prepare', { intent: 'create', prompt,
          ...(selected.length ? { ref: { resources: selected.map(({ kind, name }) => ({ kind, name })) } } : {}) })
        notice('需求已准备好，请在会话中发送。')
      } catch (error) { notice(error.message || String(error), true) }
      finally { submitting = false; updateSubmit() }
    })()
  })
  $('refresh').addEventListener('click', () => busy($('refresh'), refresh))
  client.events.on('appearance', value => applyAppearance(value))
  client.events.on('runtime', () => { void refreshProjects().catch(error => notice(error.message, true)) })
  window.addEventListener('focus', () => { void refreshAppearance().catch(() => {}) })
  await refresh().catch(error => notice(error.message, true))
  window.addEventListener('pagehide', () => { media.removeEventListener('change', systemChanged); client.dispose() }, { once: true })
}
renderSelected()
