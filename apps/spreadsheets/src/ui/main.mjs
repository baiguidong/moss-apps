import { createAppClient } from '@moss/app-sdk/ui'
import './workbench.css'

const bridge = window.mossApp
const app = bridge && createAppClient(bridge)
const ui = Object.fromEntries(['import', 'recent', 'sample', 'status', 'error', 'undo', 'redo', 'save', 'mode', 'grid', 'empty', 'activity', 'inspection', 'changes', 'change-list', 'history', 'history-panel', 'history-count', 'history-close', 'history-list', 'current', 'leave'].map(id => [id, document.getElementById(id)]))
const historyDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
const historyTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const recentKey = 'moss.spreadsheets.recent-workbooks.v1'
const workPrefix = 'moss-spreadsheets://works/'
const [routePath, routeQuery] = location.hash.split('?')
const route = /^#\/runs\/([a-f0-9-]{36})$/.exec(routePath)
const query = new URLSearchParams(routeQuery)
const inline = query.get('inline') === '1'
let runtime
let current
let baseline
let book
let busy = false
let dirty = false
let refreshTimer
let subscription
let recentItems = []
let currentFile
let savedChanges = []
let previewChanged = false
let leaving = false
let panel = ''
let historyRequest = 0

async function remember(work) {
  const session = uri => new URL(uri).searchParams.get('session')
  recentItems = [work, ...recentItems.filter(item => item.workId !== work.workId || session(item.uri) !== session(work.uri))].slice(0, 20)
  renderRecent()
  await app.storage.setItem(recentKey, recentItems)
}

function renderRecent() {
  const options = recentItems.map(item => new Option(item.title, item.uri))
  if (current && !options.some(option => option.value === current.uri)) {
    options.unshift(new Option(current.title, current.uri))
  }
  ui.recent.replaceChildren(new Option('最近工作簿', ''), ...options)
  ui.recent.value = current?.uri ?? ''
}

function setState(message = '') {
  ui.status.textContent = message
  for (const control of [ui.import, ui.sample, ui.recent]) control.disabled = busy || !app
  for (const control of [ui.undo, ui.redo]) control.disabled = busy || !current || Boolean(current.historical)
  ui.save.disabled = busy || !dirty || !current || Boolean(current.historical)
  ui.mode.disabled = busy
  ui.current.disabled = busy
  ui.grid.inert = busy
  void app?.view.setState({ busy, dirty }).catch(() => {})
}

function feedback(error) {
  ui.error.textContent = error?.message || ''
  ui.error.hidden = !error
}

async function perform(message, operation) {
  if (busy) return
  busy = true
  feedback()
  setState(message)
  let success
  try { success = await operation() }
  catch (error) { feedback(error) }
  finally {
    busy = false
    setState(success || (dirty ? '有未保存的修改' : ''))
  }
}

function snapshotEdits(before, after) {
  const edits = []
  for (const id of before.sheetOrder) {
    const original = before.sheets[id]
    const cells = after.sheets[id]?.cellData ?? {}
    for (const row of new Set([...Object.keys(original.cellData), ...Object.keys(cells)])) {
      const originalRow = original.cellData[row] ?? {}
      const updatedRow = cells[row] ?? {}
      for (const col of new Set([...Object.keys(originalRow), ...Object.keys(updatedRow)])) {
        const prior = originalRow[col]
        const next = updatedRow[col]
        const value = data => data?.t === 3 && data.v != null ? Boolean(data.v) : data?.v ?? null
        if (prior?.f === next?.f && (next?.f || value(prior) === value(next))) continue
        let letters = ''
        for (let n = Number(col) + 1; n > 0; n = Math.floor((n - 1) / 26)) {
          letters = String.fromCharCode(65 + (n - 1) % 26) + letters
        }
        edits.push({
          input: { sheet: original.name, cell: letters + (Number(row) + 1), ...(next?.f ? { formula: next.f } : { value: value(next) }) },
          before: prior?.f ?? value(prior),
          after: next?.f ?? value(next),
        })
      }
    }
  }
  return edits
}

function updateDirty() {
  clearTimeout(refreshTimer)
  if (!book || busy) return
  const edits = snapshotEdits(baseline, book.save())
  const changed = edits.length > 0
  renderChanges(changed ? edits : savedChanges, changed)
  if (changed !== dirty) {
    dirty = changed
    setState(dirty ? '有未保存的修改' : '')
  }
}

function focusCell(sheetName, cell) {
  const sheet = book?.getSheetByName(sheetName)
  if (!sheet) return
  sheet.activate()
  if (cell && /^[A-Z]{1,3}\d{1,5}$/.test(cell)) sheet.getRange(cell).activate()
}

function renderChanges(edits, pending) {
  ui.changes.textContent = edits.length ? (pending ? '未保存 ' : '已保存 ') + edits.length + ' 处修改' : '修改记录'
  ui['change-list'].replaceChildren(...edits.slice(0, 200).map(({ input, before, after }) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = input.sheet + '!' + input.cell + ' · ' + (before ?? '空白') + ' → ' + (after ?? '空白')
    button.addEventListener('click', () => focusCell(input.sheet, input.cell))
    return button
  }))
}

async function renderHistory() {
  const file = currentFile
  if (!file) return
  const request = ++historyRequest
  const list = ui['history-list']
  list.setAttribute('aria-busy', 'true')
  ui['history-count'].textContent = ''
  const message = document.createElement('p')
  message.className = 'history-message'
  message.setAttribute('role', 'status')
  message.textContent = '正在读取…'
  list.replaceChildren(message)
  try {
    const { entries } = await app.actions.invoke('editor.history', { uri: file.uri })
    if (request !== historyRequest || currentFile !== file) return
    ui['history-count'].textContent = entries.length ? entries.length + ' 条记录' : ''
    if (!entries.length) {
      message.textContent = '暂无历史记录'
      return
    }
    const groups = new Map()
    for (const entry of entries) {
      const date = new Date(entry.savedAt)
      if (!Number.isFinite(date.getTime())) continue
      const day = historyDate.format(date)
      let group = groups.get(day)
      if (!group) {
        group = document.createElement('section')
        group.className = 'history-group'
        const title = document.createElement('h3')
        title.textContent = day
        group.append(title)
        groups.set(day, group)
      }
      const button = document.createElement('button')
      button.className = 'history-entry'
      button.type = 'button'
      const chosen = current?.historical && current.uri === entry.uri && current.snapshot === entry.snapshot
      if (chosen) button.setAttribute('aria-current', 'true')
      const name = document.createElement('span')
      name.className = 'history-entry-name'
      name.textContent = entry.snapshot ? '保存前快照' : '版本 ' + (entry.version ?? 1)
      const time = document.createElement('time')
      time.dateTime = date.toISOString()
      time.textContent = historyTime.format(date)
      button.append(name, time)
      if (entry.changes || chosen) {
        const detail = document.createElement('span')
        detail.className = 'history-entry-detail'
        detail.textContent = [chosen && '正在查看', entry.changes && (entry.snapshot ? '此后修改 ' : '修改 ') + entry.changes + ' 处'].filter(Boolean).join(' · ')
        button.append(detail)
      }
      button.addEventListener('click', () => {
        if (!chosen && confirmSwitch()) void perform('正在打开历史记录…', () => openWorkbook(entry.uri, { historical: true, snapshot: entry.snapshot }))
      })
      group.append(button)
    }
    list.replaceChildren(...groups.values())
  } catch {
    if (request === historyRequest && currentFile === file) message.textContent = '历史记录读取失败，关闭后可重新打开。'
  } finally {
    if (request === historyRequest) list.removeAttribute('aria-busy')
  }
}

function togglePanel(next) {
  panel = panel === next ? '' : next
  ui.inspection.hidden = !panel
  ui['change-list'].hidden = panel !== 'changes'
  ui['history-panel'].hidden = panel !== 'history'
  ui.changes.setAttribute('aria-expanded', String(panel === 'changes'))
  ui.history.setAttribute('aria-expanded', String(panel === 'history'))
  if (panel === 'history') void renderHistory().catch(feedback)
}

async function initializeGrid() {
  if (runtime) return runtime
  const [{ createUniver, LocaleType }, { UniverSheetsCorePreset }, { default: strings }] = await Promise.all([
    import('@univerjs/presets'),
    import('@univerjs/preset-sheets-core'),
    import('@univerjs/preset-sheets-core/locales/zh-CN'),
    import('@univerjs/preset-sheets-core/lib/index.css'),
  ])
  runtime = createUniver({
    locale: LocaleType.ZH_CN,
    locales: { [LocaleType.ZH_CN]: strings },
    presets: [UniverSheetsCorePreset({
      container: ui.grid,
      toolbar: false,
      contextMenu: false,
      formulaBar: true,
      footer: { menus: false, addSheetButtonConfig: { show: false } },
    })],
  })
  const api = runtime.univerAPI
  const updateTheme = () => api.toggleDarkMode(document.documentElement.dataset.theme === 'dark')
  new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  updateTheme()
  api.addEvent(api.Event.BeforeCommandExecute, event => {
    if (/(insert|remove|delete|rename|duplicate|move|copy|hide|unhide)-(row|col|column|sheet)|(?:sheet-(?:name|order|hide)|(?:sub|work)-?sheet-(?:name|order|hide)|merge|set-(?:row-height|column-width|col-width|style|numfmt|freeze|font|border|background))/.test(event.id)) {
      event.cancel = true
    }
  })
  return runtime
}

async function loadCells(uri, sheet, snapshot) {
  const cellData = {}
  let offset = 0
  do {
    const page = await app.actions.invoke('editor.cells', { uri, sheet: sheet.name, offset, ...(snapshot ? { snapshot } : {}) })
    for (const [row, col, cell] of page.cells) (cellData[row] ??= {})[col] = cell
    offset = page.next
  } while (offset !== null)
  return {
    id: sheet.id,
    name: sheet.name,
    rowCount: Math.min(10000, Math.max(60, sheet.rows + 20)),
    columnCount: Math.min(200, Math.max(26, sheet.columns + 5)),
    columnData: Object.fromEntries(sheet.widths.map((w, index) => [index, { w }])),
    freeze: sheet.freeze,
    mergeData: sheet.mergeData,
    cellData,
  }
}

async function openWorkbook(uri, { historical = false, snapshot, sheet, cell } = {}) {
  const info = await app.actions.invoke('editor.open', { uri, ...(snapshot ? { snapshot } : {}) })
  const sheets = await Promise.all(info.sheets.map(item => loadCells(info.uri, item, snapshot)))
  const { univerAPI } = await initializeGrid()
  clearTimeout(refreshTimer)
  subscription?.dispose()
  if (book) univerAPI.disposeUnit(book.getId())
  ui.empty.hidden = true
  ui.grid.hidden = false
  const data = {
    id: crypto.randomUUID(),
    name: info.title,
    sheetOrder: sheets.map(sheet => sheet.id),
    sheets: Object.fromEntries(sheets.map(sheet => [sheet.id, sheet])),
  }
  baseline = structuredClone(data)
  book = univerAPI.createWorkbook(data)
  if (historical) await book.getWorkbookPermission().setReadOnly()
  subscription = univerAPI.addEvent(univerAPI.Event.CommandExecuted, ({ id }) => {
    if (id !== 'sheet.mutation.set-range-values') return
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(updateDirty, 100)
  })
  dirty = false
  const { title, workId, revision } = info
  current = { uri: info.uri, title, workId, revision, historical, snapshot }
  ui.activity.hidden = false
  ui.current.hidden = !historical
  if (!historical) {
    currentFile = current
    savedChanges = []
    await remember({ uri: current.uri, title, workId })
  }
  focusCell(sheet, cell)
  renderChanges([], false)
  if (panel === 'history') await renderHistory()
}

async function taskResult(receipt, uri) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const state = await app.actions.invoke('editor.status', { id: receipt.id, ...(uri ? { uri } : {}) })
    if (state.status === 'succeeded') return state.uri
    if (['failed', 'canceled', 'cancelled'].includes(state.status)) throw new Error(state.message || '工作簿处理失败')
    await new Promise(resolve => setTimeout(resolve, 220))
  }
  throw new Error('工作簿仍在处理，请稍后从会话打开。')
}

async function start(input) {
  const receipt = await app.actions.invoke('editor.start', input)
  await openWorkbook(await taskResult(receipt))
  return '工作簿已打开'
}

function confirmSwitch() {
  return !dirty || window.confirm('放弃当前工作簿未保存的修改？')
}

async function save() {
  await book.endEditingAsync(true)
  const updated = book.save()
  const edits = snapshotEdits(baseline, updated)
  if (!edits.length) {
    dirty = false
    return '没有待保存的单元格修改'
  }
  const { revision } = await app.actions.invoke('editor.save', { uri: current.uri, revision: current.revision, edits: edits.map(edit => edit.input) })
  current.revision = revision
  baseline = updated
  dirty = false
  previewChanged = true
  savedChanges = edits
  renderChanges(savedChanges, false)
  if (panel === 'history') await renderHistory().catch(feedback)
  return '已保存'
}

ui.sample.addEventListener('click', () => perform('正在创建报价示例…', () => start({
  title: 'Univer 报价测试工作簿',
  sheets: [
    { name: '报价', widths: [26, 12, 14, 18], rows: [
      ['项目', '数量', '单价', '折后金额'],
      ['办公套件', 2, { value: 100, numFmt: '0.00' }, { formula: "ROUND(B2*C2*(1-'参数'!B2),2)", numFmt: '0.00' }],
      ['实施服务', 1, { value: 250, numFmt: '0.00' }, { formula: "ROUND(B3*C3*(1-'参数'!B2),2)", numFmt: '0.00' }],
      ['合计', null, null, { formula: 'SUM(D2:D3)', numFmt: '0.00' }],
    ] },
    { name: '参数', widths: [22, 16], rows: [['参数', '取值'], ['折扣', { value: 0.1, numFmt: '0%' }]] },
  ],
})))
ui.import.addEventListener('click', () => {
  if (!confirmSwitch()) return
  void perform('正在打开工作簿…', async () => {
    const result = await app.host.request('moss.local-files/v1', 'pick', {
      kind: 'file', multiple: false,
    })
    const sourcePath = result.paths[0]
    if (!sourcePath) return
    const title = sourcePath.split(/[/\\]/).at(-1).replace(/\.(xlsx|csv|tsv)$/i, '').slice(0, 120)
    return start({ title, mode: 'read', sourcePath })
  })
})
ui.recent.addEventListener('change', () => {
  const uri = ui.recent.value
  renderRecent()
  if (uri && uri !== current?.uri && confirmSwitch()) void perform('正在加载工作簿…', () => openWorkbook(uri))
})
ui.save.addEventListener('click', () => perform('正在保存…', save))
ui.undo.addEventListener('click', async () => { await runtime.univerAPI.undo(); updateDirty() })
ui.redo.addEventListener('click', async () => { await runtime.univerAPI.redo(); updateDirty() })
ui.changes.addEventListener('click', () => togglePanel('changes'))
ui.history.addEventListener('click', () => togglePanel('history'))
ui['history-close'].addEventListener('click', () => {
  togglePanel('history')
  ui.history.focus()
})
ui.current.addEventListener('click', () => perform('正在打开当前文件…', () => openWorkbook(currentFile.uri)))

async function leavePreview(previewMode) {
  if (leaving || busy) return
  leaving = true
  try {
    if (book && !current?.historical) {
      await book.endEditingAsync(true)
      updateDirty()
    }
    if (dirty) {
      ui.leave.returnValue = 'cancel'
      ui.leave.showModal()
      const choice = await new Promise(resolve => ui.leave.addEventListener('close', () => resolve(ui.leave.returnValue), { once: true }))
      if (!choice || choice === 'cancel') return
      if (choice === 'save') {
        await perform('正在保存…', save)
        if (dirty) return
      }
    }
    const sheet = book?.getActiveSheet()?.getSheetName()
    const cell = book?.getActiveCell()?.getA1Notation()
    await app.view.setState({ busy: false, dirty: false, returnToPreview: true, previewMode, saved: previewChanged, sheet, cell })
  } catch (error) { feedback(error) }
  finally { leaving = false }
}
ui.mode.hidden = !inline
ui.mode.addEventListener('change', () => {
  const destination = ui.mode.value
  ui.mode.value = 'edit'
  if (destination !== 'edit') void leavePreview(destination)
})
if (inline) {
  document.documentElement.dataset.editorInline = ''
  ui.import.hidden = true
  ui.recent.hidden = true
  ui.sample.hidden = true
  const controls = document.querySelector('.workbook-actions')
  const layout = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--inline-tools-width', Math.ceil(controls.offsetWidth + 10) + 'px')
    document.documentElement.style.setProperty('--inspection-width', ui.inspection.offsetWidth + 'px')
  })
  layout.observe(controls)
  layout.observe(ui.inspection)
}

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && current && !current.historical) {
    event.preventDefault()
    void perform('正在保存…', save)
  }
}, { capture: true })

if (!app) {
  feedback(new Error('请在 Moss 中打开表格工作台。'))
  setState()
} else {
  void perform('正在加载工作簿…', async () => {
    const stored = await app.storage.getItem(recentKey)
    if (Array.isArray(stored)) recentItems = stored
    renderRecent()
    const session = query.get('session')
    if (route && session) await openWorkbook(workPrefix + route[1] + '?session=' + session, { sheet: query.get('sheet'), cell: query.get('cell') })
  })
}
