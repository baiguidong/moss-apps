import uPlot from 'uplot'

const { headers, rows, type } = JSON.parse(document.getElementById('chart-data').textContent)
const api = window.mossVisualization
const filter = document.getElementById('filter')
const toggles = [...document.querySelectorAll('[data-toggle]')]
const host = document.getElementById('interactive-chart')
const reset = document.getElementById('reset-zoom')
const colors = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#db2777', '#a16207', '#475569']
const ordered = type === 'scatter' ? [...rows].sort((a, b) => Number(a[0]) - Number(b[0])) : rows
const data = [ordered.map((row, i) => type === 'scatter' ? Number(row[0]) : i), ...headers.slice(1).map((_, i) => ordered.map(row => row[i + 1]))]
let state = { filter: '', hiddenSeries: [], zoom: null }, applying = false, plot
function restore(value) {
  state = {
    filter: typeof value?.filter === 'string' ? value.filter.slice(0, 200) : '',
    hiddenSeries: Array.isArray(value?.hiddenSeries) ? value.hiddenSeries.filter(i => Number.isInteger(i) && i >= 0 && i < headers.length - 1) : [],
    zoom: Array.isArray(value?.zoom) && value.zoom.length === 2 && value.zoom.every(Number.isFinite) && value.zoom[0] < value.zoom[1]
      && value.zoom[0] >= data[0][0] && value.zoom[1] <= data[0].at(-1) ? value.zoom : null,
  }
}
function render() {
  applying = true
  const update = () => {
    filter.value = state.filter
    for (const row of document.querySelectorAll('.table tbody tr')) row.hidden = !row.textContent.toLowerCase().includes(state.filter.toLowerCase())
    for (const input of toggles) {
      const i = Number(input.dataset.toggle), hidden = state.hiddenSeries.includes(i)
      input.checked = !hidden
      plot?.setSeries(i + 1, { show: !hidden })
      for (const cell of document.querySelectorAll('.table tr>*:nth-child(' + (i + 2) + ')')) cell.hidden = hidden
    }
    if (plot) {
      if (state.zoom) plot.setScale('x', { min: state.zoom[0], max: state.zoom[1] })
      else plot.setData(data)
    }
    reset.disabled = !state.zoom
  }
  // Apply changes and flush uPlot's deferred scale hooks inside the same guard.
  // Incoming Host state must not echo back through cross-preview synchronization.
  try { if (plot) plot.batch(update); else update() } finally { applying = false }
}
function save() { api?.setState(state) }
restore(api?.getState())
try {
  const ink = getComputedStyle(document.body).color
  const label = x => type === 'scatter' ? String(x) : (rows[Math.round(x)]?.[0] ?? '')
  plot = new uPlot({
    width: Math.max(240, host.clientWidth), height: 360,
    scales: { x: { time: false } },
    cursor: { drag: { x: true, y: false } },
    axes: [{ stroke: ink, values: (_, ticks) => ticks.map(label), incrs: type === 'line' ? [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000] : undefined }, { stroke: ink }],
    series: [{ label: headers[0], value: (_, value) => value == null ? '—' : label(value) }, ...headers.slice(1).map((name, i) => ({
      label: name, stroke: colors[i], width: 2,
      ...(type === 'scatter' ? { paths: () => null, points: { show: true, size: 7 } } : {}),
    }))],
    hooks: {
      setScale: [(chart, key) => {
        if (key !== 'x' || applying || !plot) return
        const { min, max } = chart.scales.x
        state.zoom = min >= data[0][0] && max <= data[0].at(-1) && min < max
          && (min > data[0][0] || max < data[0].at(-1)) ? [min, max] : null
        reset.disabled = !state.zoom; save()
      }],
      setSeries: [(chart, index, options) => {
        if (applying || !plot || index == null || options.show == null) return
        state.hiddenSeries = chart.series.slice(1).flatMap((s, i) => s.show ? [] : [i])
        render(); save()
      }],
    },
  }, data, host)
  document.getElementById('chart').hidden = true
  host.dataset.ready = 'true'
  let resizeFrame = 0, lastWidth = plot.width, lastHeight = plot.height
  const resize = () => {
    resizeFrame = 0
    const width = Math.max(240, Math.round(host.getBoundingClientRect().width))
    const height = Math.max(260, Math.min(360, Math.round(width * .55)))
    if (!width || (width === lastWidth && height === lastHeight)) return
    lastWidth = width; lastHeight = height
    plot.setSize({ width, height })
  }
  const observer = new ResizeObserver(() => {
    if (!resizeFrame) resizeFrame = requestAnimationFrame(resize)
  })
  observer.observe(host)
  resize()
  const theme = new MutationObserver(() => {
    const color = getComputedStyle(document.body).color
    for (const axis of plot.axes) axis.stroke = () => color
    plot.redraw(true, true)
  })
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
  const media = matchMedia('(prefers-color-scheme: dark)')
  const recolor = () => { const color = getComputedStyle(document.body).color; for (const axis of plot.axes) axis.stroke = () => color; plot.redraw(true, true) }
  media.addEventListener('change', recolor)
  addEventListener('pagehide', () => { observer.disconnect(); theme.disconnect(); media.removeEventListener('change', recolor); if (resizeFrame) cancelAnimationFrame(resizeFrame); plot.destroy() }, { once: true })
} catch (error) {
  host.textContent = '交互图表加载失败，已显示静态图。'
  reset.hidden = true
}
render()
filter.addEventListener('input', () => { state.filter = filter.value; render(); save() })
for (const input of toggles) input.addEventListener('change', () => { state.hiddenSeries = toggles.filter(x => !x.checked).map(x => Number(x.dataset.toggle)); render(); save() })
reset.addEventListener('click', () => { state.zoom = null; render(); save() })
addEventListener('moss:state', event => { restore(event.detail); render() })
