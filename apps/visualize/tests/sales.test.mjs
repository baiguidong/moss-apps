import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import engine from '../src/backend/engine.mjs'
import { inspectSource } from '../src/backend/source.mjs'
import { chartModel, normalizeView, selectView, chartSvg } from '../src/chart-model.mjs'
import { TaskStore, executeTask } from '@moss/engine-apps/runtime'
import { exportView } from '../src/backend/view-export.mjs'
import { composerActions } from '../src/backend/composer.mjs'

test('Excel field discovery, monthly pivot, immutable revisions and filtered session exports', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-sales-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new TaskStore(root),
    book = new ExcelJS.Workbook(),
    sourcePath = path.join(root, 'sales.xlsx')
  book.addWorksheet('说明').addRows([['说明'], ['演示数据']])
  book.addWorksheet('销售').addRows([
    ['日期', '地区', '金额'],
    [new Date('2026-01-01'), '华东', 12],
    [new Date('2026-01-03'), '华东', 8],
    [new Date('2026-02-01'), '华北', 5],
  ])
  await book.xlsx.writeFile(sourcePath)
  const source = await inspectSource({ sourcePath: 'sales.xlsx', sheet: '销售' }, root)
  assert.deepEqual(source.sheets, ['说明', '销售'])
  assert.equal(source.sample[0][0], '2026-01-01')
  const input = {
    title: '销售',
    type: 'stacked',
    sourcePath,
    sheet: '销售',
    mapping: { x: '日期', series: '地区', value: '金额', bucket: 'month' },
  }
  const task = await executeTask(engine, store, await store.create(input))
  assert.equal(task.status, 'succeeded', task.message)
  const ctx = { dataDir: root, sessionId: 'demo' }
  const output = await exportView(
    { id: task.id, format: 'csv', view: { from: '2026-01-01', to: '2026-01-31', hiddenSeries: [1] } },
    ctx,
  )
  assert.equal(await fs.readFile(output.path, 'utf8'), '日期,华东\r\n2026-01,20\r\n')
  const uri = new URL(output.resourceUri)
  uri.search = ''
  assert.equal((await composerActions(root).resolve({ uri: uri.href })).path, await fs.realpath(output.path))
  await fs.unlink(sourcePath)
  const revised = await executeTask(engine, store, await store.create({ ...input, parentId: task.id }))
  assert.equal(revised.status, 'succeeded', revised.message)
})
test('calendar spacing, signed stacks, zero matches and table SVG values', () => {
  const data = {
    headers: ['日期', '收入', '调账'],
    rows: [
      ['2026-01-31', 16, -4],
      ['2026-01-02', 12, -1],
      ['2026-01-01', 10, -2],
    ],
  }
  const model = chartModel(data, 'line')
  const selected = selectView(model, normalizeView(model))
  const [a, b, c] = selected.points
  assert.equal((c.x - b.x) / (b.x - a.x), 29)
  assert.match(chartSvg(selected, 'table', '表格'), />-4<\/text>/)
  assert.doesNotMatch(chartSvg(selected, 'table', '表格'), /data-series/)
  assert.match(chartSvg(selected, 'stacked', '金额'), /data-series="1"/)
  assert.equal(selectView(model, normalizeView(model, { filter: '无结果' })).rows.length, 0)
})
