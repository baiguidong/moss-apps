export const colors = ['#24796a', '#4674bb', '#c17832', '#8b63ac', '#c35a72', '#418b9e', '#8b8538', '#616e80']
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

export function isoDay(value) {
  const str = String(value)
  const day = /^\d{4}-\d{2}$/.test(str) ? str + '-01' : str
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return ''
  const time = Date.parse(day + 'T00:00:00Z')
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? day : ''
}

export function chartModel(data, type, xAxis = 'auto') {
  const dated = xAxis !== 'category' && data.rows.every((row) => isoDay(row[0]))
  if (xAxis === 'date' && !dated) throw new Error('日期横轴需使用有效的 YYYY-MM 或 YYYY-MM-DD')
  const continuous = type === 'scatter' || (type === 'line' && dated)
  const points = data.rows.map((row, index) => ({
    row,
    x: type === 'scatter' ? Number(row[0]) : continuous ? Date.parse(isoDay(row[0]) + 'T00:00:00Z') : index,
  }))
  if (continuous) points.sort((a, b) => a.x - b.x)
  return { headers: data.headers, points, dated, continuous, type }
}

export function normalizeView(model, value = {}) {
  const hiddenSeries = Array.isArray(value?.hiddenSeries) ? value.hiddenSeries : []
  const zoom = value?.zoom
  return {
    filter: typeof value?.filter === 'string' ? value.filter.slice(0, 200) : '',
    hiddenSeries:
      model.type === 'pie'
        ? []
        : [...new Set(hiddenSeries.filter((i) => Number.isInteger(i) && i >= 0 && i < model.headers.length - 1))],
    from: model.dated && value?.from ? isoDay(value.from) : '',
    to: model.dated && value?.to ? isoDay(value.to) : '',
    zoom:
      ['line', 'scatter'].includes(model.type) &&
      Array.isArray(zoom) &&
      zoom.length === 2 &&
      zoom.every(Number.isFinite) &&
      zoom[0] < zoom[1] &&
      zoom[0] >= model.points[0]?.x &&
      zoom[1] <= model.points.at(-1)?.x
        ? zoom
        : null,
  }
}

export function selectView(model, state, includeZoom = true) {
  const series = model.headers
    .slice(1)
    .map((_, i) => i)
    .filter((i) => !state.hiddenSeries.includes(i))
  const query = state.filter.trim().toLowerCase()
  const points = model.points.filter(({ row, x }) => {
    if (includeZoom && state.zoom && (x < state.zoom[0] || x > state.zoom[1])) return false
    const day = model.dated ? isoDay(row[0]) : ''
    return (
      (!state.from || day >= state.from) &&
      (!state.to || day <= state.to) &&
      (!query || [row[0], ...series.map((i) => row[i + 1])].some((v) => String(v).toLowerCase().includes(query)))
    )
  })
  return {
    headers: [model.headers[0], ...series.map((i) => model.headers[i + 1])],
    rows: points.map(({ row }) => [row[0], ...series.map((i) => row[i + 1])]),
    points,
    series,
    continuous: model.continuous,
    domain: includeZoom ? state.zoom : null,
  }
}

export function toCsv({ headers, rows }) {
  return (
    [headers, ...rows]
      .map((row) =>
        row
          .map((v) => {
            const text = String(v)
            return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text
          })
          .join(','),
      )
      .join('\r\n') + '\r\n'
  )
}

export function chartSvg(view, type, title, { previewWidth, metric = '', dark = false } = {}) {
  if (!view.points) {
    const model = chartModel(view, type)
    view = selectView(model, normalizeView(model))
  }
  const { headers, rows } = view
  const series = view.series ?? headers.slice(1).map((_, i) => i)
  const ink = dark ? '#e2eee9' : '#203a38',
    muted = dark ? '#b4c7be' : '#526563',
    rule = dark ? '#40534a' : '#dce5e3'
  const text = (x, y, value, extra = '') => `<text x="${x}" y="${y}" ${extra}>${escapeHtml(value)}</text>`
  let width = previewWidth || 900,
    height = 405,
    body = ''
  const heading = previewWidth ? '' : text(12, 26, title, 'font-size="18" font-weight="600"')
  if (type === 'table') {
    const widths = headers.map((h, i) =>
      Math.max(
        115,
        ...[h, ...rows.map((row) => row[i])].map((v) =>
          Array.from(String(v)).reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 15 : 9), 28),
        ),
      ),
    )
    width = widths.reduce((a, b) => a + b, 0)
    height = 48 + 33 * (rows.length + 1)
    body = `<rect y="40" width="100%" height="32" fill="#e9f1ef"/>`
    ;[headers, ...rows].forEach((row, r) => {
      let x = 0
      row.forEach((v, i) => {
        body += text(x + 12, 62 + r * 33, v, r === 0 ? 'font-weight="600"' : '')
        x += widths[i]
      })
      body += `<path d="M0 ${72 + r * 33}h${width}" stroke="${rule}"/>`
    })
  } else if (!rows.length || !series.length) {
    body = text(44, 144, '当前筛选没有可绘制的数据')
  } else if (type === 'pie') {
    const total = rows.reduce((sum, row) => sum + row[1], 0)
    const narrow = width < 510,
      radius = narrow ? Math.min(84, width * 0.28) : Math.min(135, width * 0.19)
    const cx = narrow ? width / 2 : width * 0.26,
      cy = radius + (previewWidth ? 14 : 46)
    const legendY = narrow ? cy + radius + 26 : previewWidth ? 24 : 65
    height = Math.max(cy + radius + 12, legendY + rows.length * 22)
    let angle = -Math.PI / 2
    rows.forEach((row, i) => {
      const a = angle,
        share = total ? row[1] / total : 0
      angle += share * Math.PI * 2
      const color = colors[view.points[i].x % colors.length]
      if (share === 1) body += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}"/>`
      else if (share > 0)
        body += `<path fill="${color}" d="M${cx} ${cy} L${cx + radius * Math.cos(a)} ${cy + radius * Math.sin(a)} A${radius} ${radius} 0 ${share > 0.5 ? 1 : 0} 1 ${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)} Z"/>`
      body += text(
        narrow ? 10 : width * 0.53,
        legendY + i * 22,
        `${row[0]}　${row[1]}（${(share * 100).toFixed(1)}%）`,
        `fill="${color}"`,
      )
    })
  } else {
    const left = width < 480 ? 49 : 70,
      right = width - 26
    const top = (previewWidth ? 12 : 40) + (metric ? 22 : 0),
      bottom = top + Math.max(135, Math.min(245, width * 0.37)),
      span = right - left
    height = bottom + (previewWidth ? 35 : 65 + Math.ceil(series.length / 4) * 21)
    if (metric) body += text(left, top - 10, metric, 'font-size="13"')
    let low = 0,
      high = 0
    for (const row of rows) {
      const values = row.slice(1)
      if (type === 'stacked') {
        low = Math.min(
          low,
          values.reduce((sum, v) => sum + Math.min(0, v), 0),
        )
        high = Math.max(
          high,
          values.reduce((sum, v) => sum + Math.max(0, v), 0),
        )
      } else {
        low = Math.min(low, ...values)
        high = Math.max(high, ...values)
      }
    }
    const rawStep = Math.max(Number.MIN_VALUE, (high - low || 1) / 4)
    const power = Math.max(Number.MIN_VALUE, 10 ** Math.floor(Math.log10(rawStep)))
    const step = ([1, 2, 2.5, 5, 10].find((v) => v >= rawStep / power) || 10) * power
    low = Math.floor(low / step) * step
    high = Math.max(low + step, Math.ceil(high / step) * step)
    const y = (v) => bottom - ((v - low) / (high - low)) * (bottom - top)
    const xs = view.points?.map((p) => p.x) || rows.map((_, i) => i)
    const [xmin, xmax] = view.domain || [xs[0], xs.at(-1)]
    const x = (i) =>
      view.continuous || view.domain
        ? left + (xmax === xmin ? 0.5 : (xs[i] - xmin) / (xmax - xmin)) * span
        : left + ((i + 0.5) * span) / rows.length
    for (let i = 0; i <= Math.round((high - low) / step); i++) {
      const v = low + step * i
      body +=
        `<path d="M${left} ${y(v)}H${right}" stroke="${rule}"/>` +
        text(left - 9, y(v) + 4, Number(v.toPrecision(4)), `text-anchor="end" fill="${muted}"`)
    }
    const tickStep = Math.max(1, Math.ceil(rows.length / 8))
    let lastLabel = -Infinity
    rows.forEach((r, i) => {
      if (i % tickStep === 0 && x(i) - lastLabel >= Math.min(72, span / Math.min(3, rows.length)) - 0.1) {
        body += text(x(i), bottom + 22, String(r[0]).slice(0, 15), 'text-anchor="middle"')
        lastLabel = x(i)
      }
    })
    const pos = rows.map(() => 0),
      neg = rows.map(() => 0)
    series.forEach((original, s) => {
      const color = colors[original % colors.length],
        column = s + 1
      body += `<g data-series="${original}" fill="${color}">`
      if (type === 'line')
        body += `<polyline points="${rows.map((r, i) => x(i) + ',' + y(r[column])).join(' ')}" stroke="${color}" stroke-width="2.5" fill="none"/>`
      rows.forEach((row, i) => {
        const v = row[column],
          tooltip = `<title>${escapeHtml(row[0])} · ${escapeHtml(headers[column])}　${v}</title>`
        if (type === 'bar' || type === 'stacked') {
          const stack = type === 'stacked',
            acc = v >= 0 ? pos : neg,
            start = stack ? acc[i] : 0,
            end = start + v
          if (stack) acc[i] = end
          const band = (span / rows.length) * 0.72,
            bw = band / (stack ? 1 : series.length)
          body += `<rect x="${x(i) - band / 2 + (stack ? 0 : s * bw)}" y="${Math.min(y(start), y(end))}" width="${bw * 0.96}" height="${Math.abs(y(start) - y(end))}">${tooltip}</rect>`
        } else body += `<circle cx="${x(i)}" cy="${y(v)}" r="3.6">${tooltip}</circle>`
      })
      body += '</g>'
      if (!previewWidth)
        body += text(
          left + (s % 4) * 200,
          bottom + 52 + Math.floor(s / 4) * 23,
          headers[column],
          `fill="${color}"`,
        )
    })
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}" style="max-width:100%;height:auto;font:14px system-ui,sans-serif" fill="${ink}"><title>${escapeHtml(title)}</title><rect width="100%" height="100%" fill="${previewWidth ? 'transparent' : 'white'}"/>${heading}${body}</svg>`
}
