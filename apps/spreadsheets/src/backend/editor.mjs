import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { sessionResourceUri } from '@moss/engine-apps/runtime'

const workProtocol = 'moss-spreadsheets:'
const pageBudget = 256 * 1024
const cacheFor = 60_000
const ownTaskId = /^[a-f0-9-]{36}$/

function taskId(uri) {
  const resource = new URL(uri)
  const id = resource.pathname.slice(1)
  if (resource.protocol !== workProtocol || resource.hostname !== 'works' || !ownTaskId.test(id) || resource.search || resource.hash) {
    throw new Error('工作簿引用无效')
  }
  return id
}

function excelValue(value, date1904) {
  if (value instanceof Date) return 25569 + value.getTime() / 86400000 - (date1904 ? 1462 : 0)
  if (value?.richText) return value.richText.map(run => run.text).join('')
  if (typeof value === 'object' && value !== null) return value.text ?? value.error ?? null
  return value ?? null
}

function editorCell(cell, date1904) {
  if (cell.type === ExcelJS.ValueType.Merge) return null
  const value = excelValue(cell.formula ? cell.result : cell.value, date1904)
  if (value === null && !cell.formula && !cell.hasStyle) return null
  const format = cell.numFmt
  const fill = cell.fill?.type === 'pattern' && cell.fill.pattern === 'solid' && cell.fill.fgColor?.argb
  const textColor = cell.font?.color?.argb
  const style = {
    ...(format && format !== 'General' ? { n: { pattern: format } } : {}),
    ...(fill ? { bg: { rgb: '#' + fill.slice(-6) } } : {}),
    ...(textColor ? { cl: { rgb: '#' + textColor.slice(-6) } } : {}),
    ...(cell.font?.bold ? { bl: 1 } : {}),
    ...(cell.font?.italic ? { it: 1 } : {}),
  }
  return {
    v: value,
    ...(typeof value === 'boolean' ? { t: 3 } : {}),
    ...(cell.formula ? { f: '=' + cell.formula } : {}),
    ...(Object.keys(style).length ? { s: style } : {}),
  }
}

function metadata(sheet, index) {
  const { views, rowCount, columnCount, model } = sheet
  const view = views.find(item => item.state === 'frozen')
  return {
    id: 'sheet-' + index,
    name: sheet.name,
    rows: rowCount,
    columns: columnCount,
    freeze: { xSplit: view?.xSplit ?? 0, ySplit: view?.ySplit ?? 0, startColumn: view?.xSplit ?? 0, startRow: view?.ySplit ?? 0 },
    widths: sheet.columns.slice(0, columnCount).map(column => Math.round((column.width ?? 12) * 7 + 5)),
    mergeData: (model.merges ?? []).map(range => {
      const [first, last] = range.split(':').map(address => sheet.getCell(address))
      return { startRow: first.row - 1, endRow: last.row - 1, startColumn: first.col - 1, endColumn: last.col - 1 }
    }),
  }
}

export function editorRoute(id, sessionId) {
  const link = new URL('moss-app://moss.spreadsheets/runs/' + id)
  if (sessionId) link.searchParams.set('session', sessionId)
  return link.href
}

export function registerEditor(backend, context, tasks, render) {
  let cache
  const saving = new Map()
  const workUri = id => sessionResourceUri(workProtocol + '//works/' + id, context.sessionId)

  async function source(id) {
    const task = await tasks.getTask(id)
    const item = (task.artifacts ?? []).find(file => path.extname(file.path).toLowerCase() === '.xlsx')
    if (task.status !== 'succeeded' || !item) throw new Error('工作簿尚未生成')
    const [target, root] = await Promise.all([fs.realpath(item.path), fs.realpath(path.join(context.dataDir, 'jobs', id))])
    const relative = path.relative(root, target)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('工作簿不在当前作品目录中')
    return { task, target, index: task.artifacts.indexOf(item) }
  }

  async function workbook(id, snapshot) {
    const key = snapshot ? id + '/' + snapshot : id
    if (!cache || cache.key !== key || Date.now() - cache.at > cacheFor) {
      const pending = source(id).then(async entry => {
        const filename = snapshot ? path.join(path.dirname(entry.target), '.history', snapshot + '.xlsx') : entry.target
        if (snapshot && (!ownTaskId.test(snapshot) || await fs.realpath(filename) !== filename)) throw new Error('历史工作簿不可用')
        const bytes = await fs.readFile(filename)
        const book = new ExcelJS.Workbook()
        await book.xlsx.load(bytes)
        return { ...entry, book, revision: digest(bytes) }
      })
      cache = { key, at: Date.now(), pending }
      pending.catch(() => { if (cache?.pending === pending) cache = undefined })
    }
    return cache.pending
  }

  backend.registerAction('editor.start', (input, call) => tasks.startTask(input, 'ui', call.signal))

  backend.registerAction('editor.status', async ({ id }) => {
    const task = await tasks.getTask(id)
    return { status: task.status, message: task.message, ...(task.status === 'succeeded' ? { uri: workUri(id) } : {}) }
  })

  backend.registerAction('editor.open', async ({ uri, snapshot }) => {
    const { task, book, revision } = await workbook(taskId(uri), snapshot)
    return {
      uri: workUri(task.id),
      title: task.result?.title ?? task.input.title,
      version: task.result?.version ?? 1,
      workId: task.result?.workId ?? task.id,
      revision,
      sheets: book.worksheets.map(metadata),
    }
  })

  backend.registerAction('editor.cells', async ({ uri, sheet, offset, snapshot }) => {
    const { book } = await workbook(taskId(uri), snapshot)
    const tab = book.getWorksheet(sheet)
    if (!tab) throw new Error('工作表不存在')
    const columns = tab.columnCount
    const count = tab.rowCount * columns
    const cells = []
    let bytes = 0
    let cursor = offset
    for (; cursor < count; cursor++) {
      const row = Math.floor(cursor / columns)
      const column = cursor % columns
      const data = editorCell(tab.getCell(row + 1, column + 1), book.properties.date1904)
      if (!data) continue
      const entry = [row, column, data]
      const size = Buffer.byteLength(JSON.stringify(entry)) + 1
      if (bytes + size > pageBudget && cells.length) break
      cells.push(entry)
      bytes += size
    }
    return { cells, next: cursor < count ? cursor : null }
  })

  backend.registerAction('editor.save', async ({ uri, revision, edits }, call) => {
    const id = taskId(uri)
    const pending = (saving.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const { task, target, book } = await workbook(id)
      const sourceBytes = await fs.readFile(target)
      if (revision !== digest(sourceBytes)) {
        cache = undefined
        throw new Error('文件已在别处保存，请重新打开后再编辑')
      }
      for (const edit of edits) {
        const cell = book.getWorksheet(edit.sheet)?.getCell(edit.cell)
        if (cell?.type === ExcelJS.ValueType.Merge) throw new Error('请编辑合并区域左上角的单元格')
      }
      const directory = await fs.mkdtemp(path.join(path.dirname(target), '.save-'))
      try {
        const output = await render({ title: task.result?.title ?? task.input.title, mode: 'edit', sourcePath: target, sheets: task.input.sheets, edits },
          { ...call, directory })
        const updated = await fs.readFile(output.artifacts[0].path)
        call.signal.throwIfAborted()
        if (revision !== digest(await fs.readFile(target))) throw new Error('文件已在别处保存，请重新打开后再编辑')
        const history = path.join(path.dirname(target), '.history')
        await fs.mkdir(history, { recursive: true, mode: 0o700 })
        if (await fs.realpath(history) !== history) throw new Error('历史记录目录无效')
        const snapshot = randomUUID()
        const savedAt = Date.now()
        await fs.writeFile(path.join(history, snapshot + '.xlsx'), sourceBytes, { flag: 'wx', mode: 0o600 })
        const record = path.join(history, snapshot + '.json')
        await fs.writeFile(record, JSON.stringify({ snapshot, savedAt, changes: edits.length }), { flag: 'wx', mode: 0o600 })
        try {
          call.signal.throwIfAborted()
          if (revision !== digest(await fs.readFile(target))) throw new Error('文件已在别处保存，请重新打开后再编辑')
          await fs.rename(output.artifacts[0].path, target)
        } catch (error) {
          await Promise.allSettled([fs.unlink(record), fs.unlink(path.join(history, snapshot + '.xlsx'))])
          throw error
        }
        cache = undefined
        // XLSX is authoritative. These derived artifacts can be rebuilt from it.
        await Promise.allSettled(output.artifacts.slice(1).map(async item => {
          const existing = task.artifacts.find(file => path.basename(file.path) === path.basename(item.path))
          if (existing && path.dirname(existing.path) === path.dirname(target)) await fs.rename(item.path, existing.path)
        }))
        return { revision: digest(updated), savedAt }
      } finally {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
      }
    })
    saving.set(id, pending)
    try { return await pending }
    finally { if (saving.get(id) === pending) saving.delete(id) }
  })

  backend.registerAction('editor.history', async ({ uri }) => {
    const { task, target } = await source(taskId(uri))
    const history = path.join(path.dirname(target), '.history')
    const names = await fs.readdir(history).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const snapshots = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
      return JSON.parse(await fs.readFile(path.join(history, name), 'utf8'))
    }))
    const workId = task.result?.workId ?? task.id
    const prior = []
    for (let offset = 0; ; offset += 100) {
      const page = await tasks.listTasks({ offset, limit: 100 })
      for (const item of page) {
        if (item.id !== task.id && item.status === 'succeeded' && (item.result?.workId ?? item.id) === workId) {
          prior.push({ uri: workUri(item.id), savedAt: item.createdAt, version: item.result?.version ?? 1, changes: item.input.edits?.length })
        }
      }
      if (page.length < 100) break
    }
    return { entries: [...snapshots.map(item => ({ ...item, uri: workUri(task.id) })), ...prior]
      .sort((a, b) => b.savedAt - a.savedAt) }
  })

  backend.registerAction('editor.export', async ({ uri }, call) => {
    const { task, index } = await source(taskId(uri))
    return tasks.exportArtifact(task.id, index, call)
  })
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
