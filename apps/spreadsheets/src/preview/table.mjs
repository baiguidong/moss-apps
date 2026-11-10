import { createTable, getCoreRowModel, getFilteredRowModel, getSortedRowModel, getPaginationRowModel, functionalUpdate } from '@tanstack/table-core'

const sheets = JSON.parse(document.getElementById('workbook-data').textContent)
const api = window.mossVisualization
const el = id => document.getElementById(id)
const select = el('sheet'), search = el('search'), container = el('interactive-table')
let active = 0, views = {}, table, state
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
function normalize(value, sheet) {
  const valid = id => sheet.columns.some(c => c.id === id)
  const pageSize = [25, 50, 100].includes(value?.pagination?.pageSize) ? value.pagination.pageSize : 25
  const visibility = Object.fromEntries(sheet.columns.map(c => [c.id, value?.columnVisibility?.[c.id] !== false]))
  if (sheet.columns.length && !Object.values(visibility).some(Boolean)) visibility[sheet.columns[0].id] = true
  return {
    globalFilter: typeof value?.globalFilter === 'string' ? value.globalFilter.slice(0, 200) : '',
    sorting: Array.isArray(value?.sorting) ? value.sorting.filter(s => plain(s) && valid(s.id)).slice(0, 1).map(s => ({ id: s.id, desc: !!s.desc })) : [],
    columnVisibility: visibility,
    pagination: { pageSize, pageIndex: Number.isInteger(value?.pagination?.pageIndex) ? Math.max(0, Math.min(value.pagination.pageIndex, Math.ceil(sheet.rows.length / pageSize) - 1)) : 0 },
  }
}
function persist() {
  views[active] = { globalFilter: state.globalFilter, sorting: state.sorting, columnVisibility: state.columnVisibility, pagination: state.pagination }
  for (const key of Object.keys(views)) views[key] = { ...views[key], columnVisibility: Object.fromEntries(Object.entries(views[key].columnVisibility).filter(([, visible]) => visible === false)) }
  // Host state is capped at 16 KiB. Keep the active sheet and as many other
  // sheet views as fit, without copying data or hundreds of default flags.
  for (const key of Object.keys(views)) {
    if (new TextEncoder().encode(JSON.stringify({ sheet: active, tableViews: views })).length < 12 * 1024) break
    if (key !== String(active)) delete views[key]
  }
  api?.setState({ sheet: active, tableViews: views })
}
function node(tag, text, attrs = {}) {
  const element = document.createElement(tag)
  if (text != null) element.textContent = String(text)
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value))
  return element
}
function render() {
  const focusedSort = document.activeElement?.closest('th button')?.getAttribute('aria-label')
  const pageCount = Math.max(1, table.getPageCount())
  state.pagination.pageIndex = Math.min(state.pagination.pageIndex, pageCount - 1)
  const output = node('table', null, { 'aria-label': sheets[active].name })
  const head = node('thead'), header = node('tr')
  header.append(node('th', '行', { scope: 'col' }))
  for (const column of table.getVisibleLeafColumns()) {
    const sorted = column.getIsSorted()
    const cell = node('th', null, { scope: 'col', 'aria-sort': sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none' })
    const button = node('button', column.columnDef.header + (sorted === 'asc' ? ' ↑' : sorted === 'desc' ? ' ↓' : ''), { type: 'button', 'aria-label': '按' + column.columnDef.header + '排序' })
    button.addEventListener('click', () => column.toggleSorting())
    cell.append(button); header.append(cell)
  }
  head.append(header); output.append(head)
  const body = node('tbody')
  for (const row of table.getRowModel().rows) {
    const tr = node('tr'); tr.append(node('td', row.original.number, { class: 'row-number' }))
    for (const cell of row.getVisibleCells()) {
      const [raw, label, formula] = row.original.cells[Number(cell.column.id.slice(1))]
      tr.append(node('td', label, formula ? { title: '=' + formula } : {}))
    }
    body.append(tr)
  }
  if (!body.children.length) { const row = node('tr'); row.append(node('td', '没有匹配的数据', { colspan: table.getVisibleLeafColumns().length + 1 })); body.append(row) }
  output.append(body); container.replaceChildren(output)
  if (focusedSort) for (const button of output.querySelectorAll('th button')) if (button.getAttribute('aria-label') === focusedSort) button.focus()
  search.value = state.globalFilter
  el('page-size').value = String(state.pagination.pageSize)
  el('page-status').textContent = `第 ${state.pagination.pageIndex + 1} / ${pageCount} 页 · ${table.getFilteredRowModel().rows.length} 行`
  el('previous').disabled = !table.getCanPreviousPage(); el('next').disabled = !table.getCanNextPage()
  for (const checkbox of el('column-options').querySelectorAll('input')) {
    const col = table.getColumn(checkbox.value)
    checkbox.checked = col.getIsVisible()
    checkbox.disabled = checkbox.checked && table.getVisibleLeafColumns().length === 1
  }
}
function mount() {
  const sheet = sheets[active]
  if (!sheet) return
  select.value = String(active)
  document.querySelectorAll('[data-sheet]').forEach(section => section.hidden = section.dataset.sheet !== String(active))
  state = normalize(views[active], sheet)
  table = createTable({
    data: sheet.rows, columns: sheet.columns.map((c, index) => ({ id: c.id, header: c.label,
      accessorFn: row => row.cells[index][0], enableGlobalFilter: true, sortDescFirst: false,
      sortingFn: (a, b) => {
        const x = a.original.cells[index][0], y = b.original.cells[index][0]
        return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh-CN', { numeric: true })
      },
    })),
    getRowId: row => String(row.number), getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    enableMultiSort: false, autoResetPageIndex: false, state,
    globalFilterFn: (row, id, query) => row.original.cells[Number(id.slice(1))][1].toLowerCase().includes(String(query).toLowerCase()),
    onStateChange: update => {
      state = functionalUpdate(update, state)
      table.setOptions(options => ({ ...options, state }))
      render(); persist()
    },
  })
  state = { ...table.initialState, ...state }; table.setOptions(options => ({ ...options, state }))
  const options = el('column-options'); options.replaceChildren()
  for (const column of table.getAllLeafColumns()) {
    const label = node('label'), checkbox = node('input', null, { type: 'checkbox', value: column.id })
    checkbox.addEventListener('change', () => column.toggleVisibility(checkbox.checked))
    label.append(checkbox, document.createTextNode(column.columnDef.header)); options.append(label)
  }
  el('preview-limit').textContent = sheet.rows.length < sheet.total ? `为保持预览轻量，当前载入 ${sheet.rows.length} / ${sheet.total} 行；搜索和排序仅作用于已载入数据。完整数据见 XLSX。` : ''
  document.querySelectorAll('.static-table').forEach(item => item.hidden = true)
  container.hidden = false; el('pagination').hidden = false
  render()
}
function restore(value) {
  active = Number.isInteger(value?.sheet) && value.sheet >= 0 && value.sheet < sheets.length ? value.sheet : 0
  views = {}
  if (plain(value?.tableViews)) for (let i = 0; i < sheets.length; i++) if (plain(value.tableViews[i])) views[i] = normalize(value.tableViews[i], sheets[i])
  mount()
}
select.addEventListener('change', () => { active = Number(select.value); mount(); persist() })
search.addEventListener('input', () => { state.pagination.pageIndex = 0; table.setGlobalFilter(search.value) })
el('previous').addEventListener('click', () => table.previousPage())
el('next').addEventListener('click', () => table.nextPage())
el('page-size').addEventListener('change', () => { state.pagination.pageIndex = 0; table.setPageSize(Number(el('page-size').value)) })
el('reset-view').addEventListener('click', () => { delete views[active]; mount(); persist() })
addEventListener('moss:state', event => restore(event.detail))
restore(api?.getState())
