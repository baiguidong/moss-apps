import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskStore, sessionResourceUri } from '@moss/engine-apps/runtime'
import { composerActions } from './composer.mjs'
import { chartSource, csvMatrix, prepareData, inspectSource } from './source.mjs'
import { chartModel, chartSvg, escapeHtml, normalizeView, selectView, toCsv, colors } from '../chart-model.mjs'
import { exportView } from './view-export.mjs'
export { parseCsv } from './source.mjs'
export { chartSvg, escapeHtml } from '../chart-model.mjs'

const types = ['bar', 'stacked', 'line', 'pie', 'scatter', 'table']
function validateChart(input, data) {
  if (
    input.type === 'scatter' &&
    data.rows.some((r) => !Number.isFinite(Number(r[0])) || Math.abs(Number(r[0])) > 1e15)
  )
    throw new Error('散点图第一列必须是数值 X 坐标')
  if (input.type === 'pie' && (data.rows.some((r) => r[1] < 0) || data.rows.every((r) => r[1] === 0)))
    throw new Error('饼图数值必须非负，且合计大于 0')
  if (input.xAxis === 'date') chartModel(data, input.type, input.xAxis)
}
export function validate(input) {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120)
    throw new Error('请输入 1–120 字的标题')
  if (input.parentId !== undefined && !/^[a-f0-9-]{36}$/.test(input.parentId)) throw new Error('原作品 ID 无效')
  if (input.mode === 'html') {
    if (typeof input.html !== 'string' || !input.html.trim() || Buffer.byteLength(input.html) > 1024 ** 2)
      throw new Error('HTML 不能为空，最多支持 1 MiB')
    return
  }
  if (input.mode && input.mode !== 'chart') throw new Error('不支持的创作模式')
  if (!types.includes(input.type || 'bar')) throw new Error('不支持的图表类型')
  if (input.csv !== undefined && input.sourcePath !== undefined)
    throw new Error('请选择附件或 CSV 文本其中一个数据源')
  if (input.sourcePath !== undefined) {
    if (typeof input.sourcePath !== 'string' || !input.sourcePath.trim()) throw new Error('请指定附件路径')
  } else validateChart(input, prepareData(csvMatrix(input.csv), input.mapping))
}
export function htmlDocument(title, body) {
  const csp =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escapeHtml(title)}</title><style>html{color-scheme:light dark}*{box-sizing:border-box}body{font:15px/1.55 system-ui,sans-serif;margin:18px;color:light-dark(#203531,#e2eee9);background:light-dark(#fff,#202621)}button,input{font:inherit}button{cursor:pointer}h1{font-size:22px;line-height:1.35}h2{font-size:20px}@media(max-width:500px){body{margin:10px}}</style></head><body>${body}</body></html>`
}
async function chartHtml(input, data, taskId, model, svg) {
  const [js, css] = await Promise.all(
    ['chart.js', 'chart.css'].map((name) =>
      fs.readFile(new URL('../../dist/preview/' + name, import.meta.url), 'utf8'),
    ),
  )
  const type = model.type
  const serialized = JSON.stringify({
    ...data,
    title: input.title,
    type,
    xAxis: input.xAxis,
    metric: input.mapping?.value,
    taskId,
  }).replace(/</g, '\\u003c')
  const toggles =
    type === 'pie'
      ? ''
      : data.headers
          .slice(1)
          .map(
            (name, i) =>
              `<label class="series"><input type="checkbox" data-toggle="${i}" checked style="accent-color:${colors[i]}">${escapeHtml(name)}</label>`,
          )
          .join('')
  const dates = model.dated
    ? '<label>开始日期<input id="from" type="date"></label><label>结束日期<input id="to" type="date"></label>'
    : ''
  const interactive = ['line', 'scatter'].includes(type)
  const fallback =
    type === 'table'
      ? `<table><thead><tr>${data.headers.map((h) => '<th>' + escapeHtml(h) + '</th>').join('')}</tr></thead><tbody>${data.rows.map((r) => '<tr>' + r.map((v) => '<td>' + escapeHtml(v) + '</td>').join('') + '</tr>').join('')}</tbody></table>`
      : svg
  return htmlDocument(
    input.title,
    `<style>${css}
  :root{--line:light-dark(#d6e2dc,#40534a);--surface:light-dark(#f2f7f4,#28372f);--muted:light-dark(#53665e,#adc2b6)}
  .toolbar,.series-list,.details{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:end}.toolbar label{display:grid;gap:3px;color:var(--muted);font-size:12px}
  input:not([type=checkbox]),button{border:1px solid var(--line);border-radius:6px;color:inherit;background:transparent;padding:5px 8px;max-width:100%}
  button:disabled{opacity:.55}.series-list{margin:12px 0 8px}.series{display:inline-flex;align-items:center;gap:4px}
  .details{border-top:1px solid var(--line);padding-top:10px;align-items:center;margin:12px 0 8px}.details output{margin-right:auto;color:var(--muted)}
  .table{max-width:100%;overflow:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{text-align:right;padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap}th{background:var(--surface)}td:first-child,th:first-child{text-align:left}
  #interactive-chart{min-width:0;overflow:hidden}.u-legend{white-space:normal}.u-legend th,.u-legend td{background:transparent;border:0}.uplot{font:13px system-ui}
  #chart svg{display:block;width:100%}
  </style><h1>${escapeHtml(input.title)}</h1><div class="toolbar"><label>筛选图表和明细<input id="filter" type="search" maxlength="200" placeholder="输入标签或数值"></label>${dates}</div><div class="series-list">${toggles}${interactive ? '<button type="button" id="reset-zoom">重置缩放</button>' : ''}</div>
  ${interactive ? '<div id="interactive-chart" aria-label="拖动选择区间，悬停查看数值"></div>' : ''}<div id="chart" ${type === 'table' ? 'hidden' : ''}></div>
  <div class="details"><output id="row-count" aria-live="polite"></output><button type="button" data-export="csv">导出当前 CSV</button><button type="button" data-export="svg">导出当前 SVG</button></div>
  <div class="table"><table id="values" aria-label="当前视图数据"></table></div><noscript>${fallback}</noscript>
  <script type="application/json" id="chart-data">${serialized}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script>`,
  )
}
const examples = new URL('../../resources/skills/moss-visualize/examples/', import.meta.url)
export default {
  id: 'visualize',
  spec: { version: '0.2.0' },
  validate,
  workerEnv: (ctx) => ({ MOSS_VISUALIZE_WORKSPACE: ctx.workspace || '' }),
  async register(backend, ctx) {
    const composer = composerActions(ctx.dataDir)
    backend.registerAction('composer.list', composer.list)
    backend.registerAction('composer.resolve', composer.resolve)
    backend.registerAction('files.import', (input) => inspectSource(input, ctx.workspace, ctx.dataDir))
    backend.registerAction('views.export', (input) => exportView(input, ctx))
  },
  async catalog() {
    const templates = await Promise.all(
      [
        ['compound-growth', '可调节的复利演示'],
        ['pricing-comparison', '双方案定价比较'],
      ].map(async ([id, title]) => ({
        id,
        title,
        html: await fs.readFile(new URL(id + '.html', examples), 'utf8'),
      })),
    )
    return {
      version: '0.2.0',
      types,
      templates,
      instructions: await fs.readFile(
        new URL('../../resources/skills/moss-visualize/references/runtime.md', import.meta.url),
        'utf8',
      ),
    }
  },
  async execute(input, ctx) {
    validate(input)
    ctx.signal.throwIfAborted()
    await ctx.progress('正在生成可视化')
    const taskId = path.basename(ctx.directory)
    const parent = input.parentId ? await new TaskStore(ctx.dataDir).get(input.parentId) : null
    if (parent && (parent.status !== 'succeeded' || !parent.result?.resourceUri))
      throw new Error('原作品尚未生成，无法创建新版本')
    let html, sourceFileName
    const files = []
    if (input.mode === 'html') html = htmlDocument(input.title, input.html)
    else {
      const source = await chartSource(input, ctx, parent),
        data = source.data,
        type = input.type || 'bar'
      sourceFileName = source.sourceFileName
      validateChart(input, data)
      const model = chartModel(data, type, input.xAxis),
        svg = chartSvg(selectView(model, normalizeView(model)), type, input.title, {
          metric: input.mapping?.value,
        })
      html = await chartHtml(input, data, taskId, model, svg)
      files.push(
        ['chart.svg', svg, 'image'],
        ['data.csv', (!input.mapping && input.csv) || toCsv(data), 'text'],
        ['data.json', JSON.stringify(data, null, 2), 'json'],
      )
    }
    if (Buffer.byteLength(html) > 2 * 1024 ** 2) throw new Error('生成的作品超过 2 MiB，请减少数据或拆分图表')
    files.unshift([
      'visualization.html',
      html,
      'html',
      input.title.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_') + '.html',
    ])
    files.push(['source.json', JSON.stringify(input, null, 2), 'json', '创作源文件.json'])
    const artifacts = []
    for (const [file, content, kind, name] of files) {
      const target = path.join(ctx.directory, file)
      await fs.writeFile(target, content)
      artifacts.push({ name: name || file, path: target, kind })
    }
    if (sourceFileName)
      artifacts.push({
        name: path.basename(input.sourcePath),
        path: path.join(ctx.directory, sourceFileName),
        kind: 'file',
      })
    const resourceUri = sessionResourceUri('moss-visualize://works/' + taskId, ctx.sessionId)
    return {
      artifacts,
      message: '可视化已生成',
      result: {
        mode: input.mode || 'chart',
        resourceUri,
        workId: parent?.result.workId || parent?.id || taskId,
        version: (parent?.result.version || 0) + 1,
        parentId: input.parentId || null,
        sourceFile: sourceFileName,
        presentation: {
          items: [{ resource_uri: resourceUri, title: input.title, role: 'primary' }],
          mode: 'auto',
        },
        displayMarkdown:
          '```moss-visualization\n' + JSON.stringify({ resource_uri: resourceUri, title: input.title }) + '\n```',
      },
    }
  },
}
