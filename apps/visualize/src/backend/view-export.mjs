import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TaskStore, sessionResourceUri } from '@moss/engine-apps/runtime'
import { chartModel, normalizeView, selectView, chartSvg, toCsv } from '../chart-model.mjs'

export async function exportView({ id, format, view }, ctx) {
  const store = new TaskStore(ctx.dataDir)
  const task = await store.get(id)
  if (task.status !== 'succeeded' || task.input.mode === 'html') throw new Error('请选择已生成的内置图表或表格')
  if (!['csv', 'svg'].includes(format)) throw new Error('当前视图支持 CSV 或 SVG')
  const directory = store.directory(id)
  const data = JSON.parse(await fs.readFile(path.join(directory, 'data.json'), 'utf8'))
  const type = task.input.type || 'bar',
    model = chartModel(data, type, task.input.xAxis)
  const selected = selectView(model, normalizeView(model, view))
  const exportId = randomUUID(),
    file = path.join(directory, exportId + '.' + format)
  await fs.writeFile(
    file,
    format === 'csv'
      ? toCsv(selected)
      : chartSvg(selected, type, task.input.title, { metric: task.input.mapping?.value }),
    { flag: 'wx' },
  )
  const resourceUri = sessionResourceUri(`moss-visualize://files/${id}/${exportId}/${format}`, ctx.sessionId)
  return {
    path: file,
    resourceUri,
    rows: selected.rows.length,
    columns: selected.headers,
    displayMarkdown: `[当前视图.${format}](${resourceUri})`,
  }
}
