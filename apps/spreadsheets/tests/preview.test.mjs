import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { workbookPreview } from '../src/backend/preview.mjs'

test('offline preview bounds data, preserves source row numbers and embeds escaped data', async () => {
  const book = new ExcelJS.Workbook(); book.title = '大表'
  const sheet = book.addWorksheet('数据'); sheet.addRow(['内容', '数值'])
  const text = '</script><img onerror=alert(1)>'.repeat(10)
  for (let i = 0; i < 3000; i++) sheet.addRow([text + i, i])
  const html = await workbookPreview(book, [], cell => cell.value ?? '', () => '')
  const data = JSON.parse(/id="workbook-data">([\s\S]*?)<\/script>/.exec(html)[1])
  assert.ok(data[0].rows.length < data[0].total)
  assert.equal(data[0].total, 3000)
  assert.equal(data[0].rows[0].number, 2)
  assert.equal(data[0].rows[0].cells[0][1], text + '0')
  assert.ok(Buffer.byteLength(html) < 2 * 1024 ** 2)
  assert.doesNotMatch(html, /<img onerror/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /TanStack Table/)
  assert.equal(sheet.rowCount, 3001)
})
