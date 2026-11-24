import uPlot from 'uplot'
import { chartModel, chartSvg, colors, normalizeView, selectView, toCsv } from '../chart-model.mjs'

const payload = JSON.parse(document.querySelector('#chart-data').textContent)
const model = chartModel(payload, payload.type, payload.xAxis)
const api = window.mossVisualization
const get = (id) => document.getElementById(id)
const graph = get('chart'),
  host = get('interactive-chart'),
  reset = get('reset-zoom')
const toggles = [...document.querySelectorAll('[data-toggle]')]
const table = get('values'),
  summary = get('row-count')
let state = normalizeView(model, api?.getState()),
  plot,
  applying = false
let plotPoints = model.points
const byX = new Map(model.points.map((p) => [p.x, p.row[0]]))
const label = (x) =>
  model.type === 'scatter'
    ? String(x)
    : model.continuous
      ? new Date(x).toISOString().slice(0, 10)
      : (byX.get(x) ?? '')
function drawStatic(selected) {
  const previewWidth = Math.max(220, Math.floor(graph.clientWidth))
  const scheme = getComputedStyle(document.documentElement).colorScheme
  const dark = scheme === 'dark' || (scheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  graph.innerHTML = chartSvg(selected, model.type, payload.title, { previewWidth, metric: payload.metric, dark })
}
const plotData = (points) => [
  points.map((p) => p.x),
  ...model.headers.slice(1).map((_, i) => points.map((p) => p.row[i + 1])),
]

function renderDetails() {
  const current = selectView(model, state)
  summary.textContent = `${current.rows.length} / ${model.points.length} 行`
  const head = document.createElement('thead'),
    body = document.createElement('tbody')
  const rowNode = (cells, tag) => {
    const row = document.createElement('tr')
    for (const value of cells) {
      const cell = document.createElement(tag)
      cell.textContent = String(value)
      if (tag === 'th') cell.scope = 'col'
      row.append(cell)
    }
    return row
  }
  head.append(rowNode(current.headers, 'th'))
  body.append(...current.rows.map((row) => rowNode(row, 'td')))
  table.replaceChildren(head, body)
  reset && (reset.disabled = !state.zoom)
  if (model.type !== 'table' && (!plot || host.hidden)) drawStatic(current)
}

function render() {
  applying = true
  try {
    get('filter').value = state.filter
    if (get('from')) {
      get('from').value = state.from
      get('to').value = state.to
    }
    for (const input of toggles) input.checked = !state.hiddenSeries.includes(Number(input.dataset.toggle))
    if (plot) {
      plotPoints = selectView(model, state, false).points
      host.hidden = !plotPoints.length || state.hiddenSeries.length === model.headers.length - 1
      graph.hidden = !host.hidden
      plot.batch(() => {
        plot.setData(plotData(plotPoints))
        for (const [i, input] of toggles.entries()) plot.setSeries(i + 1, { show: input.checked })
        if (state.zoom) plot.setScale('x', { min: state.zoom[0], max: state.zoom[1] })
      })
    }
    renderDetails()
  } finally {
    applying = false
  }
}
function commit(changes) {
  state = normalizeView(model, { ...state, ...changes })
  render()
  api?.setState(state)
}
if (host) {
  const ink = () => getComputedStyle(document.body).color
  try {
    plot = new uPlot(
      {
        width: Math.max(240, host.clientWidth),
        height: 310,
        scales: { x: { time: false } },
        cursor: { drag: { x: true, y: false } },
        axes: [
          {
            stroke: ink,
            space: model.dated ? 95 : 65,
            values: (_, ticks) => ticks.map(label),
            incrs: model.continuous
              ? model.dated
                ? [1, 2, 7, 14, 30, 90, 365, 3650].map((days) => days * 86400000)
                : undefined
              : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
          },
          { stroke: ink, label: payload.metric, labelSize: payload.metric ? 18 : 0 },
        ],
        series: [
          { label: model.headers[0], value: (_, v) => (v == null ? '—' : label(v)) },
          ...model.headers.slice(1).map((name, i) => ({
            label: name,
            stroke: colors[i],
            width: 2,
            ...(model.type === 'scatter' ? { paths: () => null, points: { show: true, size: 7 } } : {}),
          })),
        ],
        hooks: {
          setScale: [
            (chart, key) => {
              if (key !== 'x' || applying || !plot || !plotPoints.length) return
              const { min, max } = chart.scales.x
              const lo = plotPoints[0].x,
                hi = plotPoints.at(-1).x
              state.zoom =
                min < max && (min > lo || max < hi) && Math.max(lo, min) < Math.min(hi, max)
                  ? [Math.max(lo, min), Math.min(hi, max)]
                  : null
              renderDetails()
              api?.setState(state)
            },
          ],
          setSeries: [
            (chart, index, options) => {
              if (!applying && plot && index != null && options.show != null)
                commit({ hiddenSeries: chart.series.slice(1).flatMap((s, i) => (s.show ? [] : [i])) })
            },
          ],
        },
      },
      plotData(model.points),
      host,
    )
    host.dataset.ready = 'true'
    const resize = new ResizeObserver(() => {
      const width = Math.round(host.clientWidth)
      if (width >= 200 && width !== plot.width)
        plot.setSize({ width, height: Math.max(245, Math.min(340, Math.round(width * 0.48))) })
    })
    resize.observe(host)
    const redraw = () => plot.redraw(true, true),
      theme = new MutationObserver(redraw)
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme'],
    })
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', redraw)
    addEventListener(
      'pagehide',
      () => {
        resize.disconnect()
        theme.disconnect()
        media.removeEventListener('change', redraw)
        plot.destroy()
      },
      { once: true },
    )
  } catch {
    host.hidden = true
    reset.hidden = true
  }
}
get('filter').addEventListener('input', (event) => commit({ filter: event.target.value, zoom: null }))
for (const id of ['from', 'to'])
  get(id)?.addEventListener('change', (event) => commit({ [id]: event.target.value, zoom: null }))
for (const toggle of toggles)
  toggle.addEventListener('change', () =>
    commit({ hiddenSeries: toggles.filter((t) => !t.checked).map((t) => Number(t.dataset.toggle)) }),
  )
reset?.addEventListener('click', () => commit({ zoom: null }))
addEventListener('moss:state', (event) => {
  state = normalizeView(model, event.detail)
  render()
})
for (const button of document.querySelectorAll('[data-export]'))
  button.addEventListener('click', () => {
    const format = button.dataset.export
    if (api?.requestFollowUp) {
      api.requestFollowUp(`请将当前筛选视图保存为 ${format.toUpperCase()} 文件，并把文件链接发到会话中。`)
      return
    }
    const selected = selectView(model, state)
    const content =
      format === 'csv'
        ? toCsv(selected)
        : chartSvg(selected, model.type, payload.title, { metric: payload.metric })
    const url = URL.createObjectURL(
      new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'image/svg+xml' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = payload.title + ' · 当前视图.' + format
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  })
render()

if (model.type !== 'table') {
  let lastWidth = 0
  const redraw = () => {
    if (!graph.hidden) drawStatic(selectView(model, state))
  }
  const resize = new ResizeObserver(() => {
    if (graph.clientWidth !== lastWidth) {
      lastWidth = graph.clientWidth
      redraw()
    }
  })
  const theme = new MutationObserver(redraw),
    media = matchMedia('(prefers-color-scheme: dark)')
  resize.observe(graph)
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
  media.addEventListener('change', redraw)
  addEventListener(
    'pagehide',
    () => {
      resize.disconnect()
      theme.disconnect()
      media.removeEventListener('change', redraw)
    },
    { once: true },
  )
}
