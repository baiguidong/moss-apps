import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { inputFile } from '@moss/creation-apps'
import { officeZip } from '@moss/creation-apps/office'
import { isoDay } from '../chart-model.mjs'

const maxRecords = 50000
export function csvMatrix(text, limit = 1024 * 1024) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > limit) throw new Error('CSV 超过输入大小限制')
  const rows = []
  let row = [],
    cell = '',
    quoted = false,
    closed = false
  const endCell = () => {
    row.push(cell)
    cell = ''
    closed = false
  }
  const endRow = () => {
    endCell()
    if (row.some((v) => v.trim())) rows.push(row)
    if (rows.length > maxRecords + 1 || row.length > 256) throw new Error('数据源最多 50000 行、256 列')
    row = []
  }
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') cell += c
      else if (text[i + 1] === '"') {
        cell += '"'
        i++
      } else {
        quoted = false
        closed = true
      }
    } else if (c === ',') endCell()
    else if (c === '\n' || c === '\r') {
      endRow()
      if (c === '\r' && text[i + 1] === '\n') i++
    } else if (c === '"' && !cell && !closed) quoted = true
    else if (c === '"' || closed) throw new Error('CSV 引号位置无效')
    else cell += c
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  endRow()
  return rows
}

function matrixData(matrix) {
  if (matrix.length < 2) throw new Error('需要表头及至少一行数据')
  const headers = matrix[0].map((v) => String(v ?? '').trim())
  if (headers.some((v) => !v) || new Set(headers).size !== headers.length) throw new Error('表头不能为空或重复')
  const rows = matrix.slice(1)
  rows.forEach((r, i) => {
    if (r.length !== headers.length) throw new Error(`第 ${i + 2} 行列数与表头不符`)
  })
  return { headers, rows }
}
function number(value, row) {
  if (String(value ?? '').trim() === '' || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1e15)
    throw new Error(`第 ${row + 2} 行包含空值或非数值，请先整理数据`)
  return Number(value)
}
function checkSize(data) {
  if (data.rows.length > 1000 || data.headers.length < 2 || data.headers.length > 9)
    throw new Error('图表支持 1–1000 行及 1–8 个数值系列，请分组汇总或减少字段')
  return data
}

export function prepareData(matrix, mapping) {
  const { headers, rows } = matrixData(matrix)
  if (!mapping) {
    checkSize({ headers, rows })
    return {
      headers,
      rows: rows.map((r, i) => {
        if (!String(r[0] ?? '').trim()) throw new Error(`第 ${i + 2} 行标签为空`)
        return [String(r[0]), ...r.slice(1).map((v) => number(v, i))]
      }),
    }
  }
  const field = (name) => {
    const index = headers.indexOf(name)
    if (index < 0) throw new Error(`找不到字段「${name}」，可选字段为 ${headers.join('、')}`)
    return index
  }
  const x = field(mapping.x),
    y = field(mapping.value),
    group = mapping.series ? field(mapping.series) : -1
  const groups = new Set(),
    totals = new Map()
  rows.forEach((r, i) => {
    let key = String(r[x] ?? '').trim()
    const series = group < 0 ? mapping.value : String(r[group] ?? '').trim()
    if (!key || !series) throw new Error(`第 ${i + 2} 行的分组字段为空`)
    if (mapping.bucket) {
      key = isoDay(key)
      if (!key) throw new Error(`第 ${i + 2} 行不是有效日期，无法按日期汇总`)
      if (mapping.bucket === 'month') key = key.slice(0, 7)
    }
    groups.add(series)
    if (!totals.has(key)) totals.set(key, new Map())
    if (groups.size > 8 || totals.size > 1000) throw new Error('汇总后超过 1000 行或 8 个系列')
    const bucket = totals.get(key)
    bucket.set(series, number((bucket.get(series) || 0) + number(r[y], i), i))
  })
  const series = [...groups]
  const keys = [...totals.keys()]
  if (mapping.bucket) keys.sort()
  return checkSize({
    headers: [mapping.x, ...series],
    rows: keys.map((key) => [key, ...series.map((s) => totals.get(key).get(s) ?? 0)]),
  })
}

export const parseCsv = (text) => prepareData(csvMatrix(text))

async function sourceFile(sourcePath, workspace) {
  if (!path.isAbsolute(sourcePath) && !workspace) throw new Error('需要附件的完整路径或会话工作区')
  const target = await inputFile(path.resolve(workspace || '.', sourcePath), ['.csv', '.xlsx'], 16 * 1024 ** 2)
  if (!path.isAbsolute(sourcePath)) {
    const rel = path.relative(await fs.realpath(workspace), target)
    if (rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('相对路径必须位于当前会话工作区')
  }
  return target
}
function cellValue(cell) {
  const value = cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (value?.richText) return value.richText.map((run) => run.text).join('')
  if (value?.error) return value.error
  return value?.text ?? value ?? ''
}
async function readFileMatrix(file, sheetName) {
  if (path.extname(file).toLowerCase() === '.csv') {
    if (sheetName) throw new Error('CSV 无需指定工作表')
    return { matrix: csvMatrix(await fs.readFile(file, 'utf8'), 16 * 1024 ** 2), sheets: [] }
  }
  await officeZip(file)
  const book = new ExcelJS.Workbook()
  await book.xlsx.readFile(file)
  const sheets = book.worksheets.map((sheet) => sheet.name),
    sheet = sheetName ? book.getWorksheet(sheetName) : book.worksheets[0]
  if (!sheet) throw new Error(`找不到工作表，可选工作表为 ${sheets.join('、')}`)
  if (sheet.rowCount > maxRecords + 1 || sheet.columnCount > 256) throw new Error('工作表最多 50000 行、256 列')
  const matrix = []
  sheet.eachRow((row) => {
    const width = matrix[0]?.length ?? row.cellCount
    if (row.actualCellCount && row.cellCount > width && row.values.slice(width + 1).some((v) => v != null))
      throw new Error('存在未命名的数据列')
    const cells = Array.from({ length: width }, (_, i) => cellValue(row.getCell(i + 1)))
    if (cells.some((v) => String(v).trim())) matrix.push(cells)
  })
  return { matrix, sheets, sheet: sheet.name }
}
export async function inspectSource(input, workspace, dataDir) {
  const file = await sourceFile(input.sourcePath, workspace)
  let sourcePath = file,
    directory
  if (dataDir) {
    const imports = path.join(dataDir, 'imports')
    await fs.mkdir(imports, { recursive: true })
    directory = await fs.mkdtemp(path.join(imports, 'attachment-'))
    sourcePath = path.join(directory, path.basename(file))
  }
  try {
    if (directory) await fs.copyFile(file, sourcePath)
    const { matrix, sheet, sheets } = await readFileMatrix(sourcePath, input.sheet)
    const headers = (matrix[0] || []).map((value) => String(value ?? '').trim())
    return {
      sourcePath,
      sheet,
      sheets,
      headers,
      rowCount: Math.max(0, matrix.length - 1),
      sample: matrix.slice(1, 6),
    }
  } catch (error) {
    if (directory) await fs.rm(directory, { recursive: true, force: true })
    throw error
  }
}
export async function chartSource(input, ctx, parent) {
  if (!input.sourcePath) return { data: prepareData(csvMatrix(input.csv), input.mapping) }
  // A revision can reuse its parent's immutable attachment even after the original file moves.
  const saved = parent?.result?.sourceFile
  const file =
    saved && parent.input.sourcePath === input.sourcePath
      ? path.join(ctx.dataDir, 'jobs', parent.id, path.basename(saved))
      : await sourceFile(input.sourcePath, process.env.MOSS_VISUALIZE_WORKSPACE)
  const sourceFileName = 'attachment' + path.extname(file).toLowerCase()
  const snapshot = path.join(ctx.directory, sourceFileName)
  await fs.copyFile(file, snapshot)
  const { matrix } = await readFileMatrix(snapshot, input.sheet)
  return { data: prepareData(matrix, input.mapping), sourceFileName }
}
