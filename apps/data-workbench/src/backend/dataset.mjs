import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { atomic, ensureBinary, existingPaths, run } from '@moss/engine-apps/runtime'
import { APP_ERROR_CODES, AppServiceError } from '@moss/app-sdk'
import engine, { fileSql } from './engine.mjs'

const sourceIdPattern = /^[a-f0-9-]{36}$/
const resultIdPattern = /^[a-f0-9-]{36}$/
const supported = new Set(['.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.parquet'])
const resultLifetimeMs = 15 * 60_000
const maxResultBytes = 16 * 1024 * 1024
const maxResultCacheBytes = 256 * 1024 * 1024
const maxResultFiles = 512

function storageUnavailable() {
  return new AppServiceError(APP_ERROR_CODES.backendUnavailable, '本地数据工作台共享存储暂时不可用')
}

function sourcesFile(ctx) { return path.join(ctx.dataDir, 'dataset-sources.json') }
function resultFile(ctx, id) {
  if (typeof id !== 'string' || !resultIdPattern.test(id)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, '结果引用无效')
  }
  return path.join(ctx.dataDir, 'dataset-results', `${id}.json`)
}
async function sources(ctx) {
  let entries
  try { entries = JSON.parse(await fs.readFile(sourcesFile(ctx), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return []; throw storageUnavailable() }
  if (!Array.isArray(entries) || entries.some(source => !source || typeof source !== 'object'
    || typeof source.id !== 'string' || !sourceIdPattern.test(source.id)
    || typeof source.path !== 'string' || !path.isAbsolute(source.path)
    || typeof source.name !== 'string' || !supported.has(source.format))) throw storageUnavailable()
  return entries
}
function publicSource(source) { return { id: source.id, name: source.name, format: source.format } }
async function sourceById(ctx, id) {
  if (typeof id !== 'string' || !sourceIdPattern.test(id)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, '数据源 ID 无效')
  }
  const source = (await sources(ctx)).find(item => item.id === id)
  if (!source) throw new AppServiceError(APP_ERROR_CODES.notFound, '数据源不存在或已取消共享')
  let actual, stat
  try { actual = await fs.realpath(source.path); stat = await fs.stat(actual) }
  catch (error) {
    if (error.code === 'ENOENT') throw new AppServiceError(APP_ERROR_CODES.notFound, '数据源文件已移除')
    throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, '共享数据源暂时无法访问')
  }
  if (actual !== source.path) throw new AppServiceError(APP_ERROR_CODES.conflict, '数据源路径已改变，请重新添加', { kind: 'source_path' })
  if (!stat.isFile()) throw new AppServiceError(APP_ERROR_CODES.notFound, '数据源不再是文件')
  // ctime detects in-place edits even if an actor restores the file's mtime.
  const revision = createHash('sha256').update(JSON.stringify([source.id, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs])).digest('hex')
  return { ...source, revision }
}
function assertRevision(source, expectedRevision) {
  if (expectedRevision !== undefined && source.revision !== expectedRevision) {
    throw new AppServiceError(APP_ERROR_CODES.conflict, '数据源已发生变化，请重新检查映射',
      { kind: 'source_revision', sourceId: source.id, currentRevision: source.revision })
  }
}
async function duckdb(ctx, sql, maxBytes = 512 * 1024) {
  try {
    const binary = await ensureBinary(engine.spec, ctx.dataDir, ctx.signal)
    const { stdout } = await run(binary, ['-json', '-c', sql], { signal: ctx.signal, maxBytes })
    const rows = JSON.parse(stdout || '[]')
    if (!Array.isArray(rows)) throw new Error('DuckDB 未返回表格结果')
    return rows
  } catch (error) {
    if (ctx.signal?.aborted) throw error
    throw new Error('数据源查询失败，请在本地数据工作台检查文件、格式和查询范围')
  }
}
async function describe(ctx, source, queryRows) {
  const rows = await queryRows(ctx, `DESCRIBE ${fileSql(source.path)}`)
  assertRevision(await sourceById(ctx, source.id), source.revision)
  const columns = rows.map(row => ({ name: String(row.column_name), type: String(row.column_type), nullable: row.null !== 'NO' }))
  const schemaFingerprint = createHash('sha256').update(JSON.stringify(columns)).digest('hex')
  return { sourceId: source.id, name: source.name, revision: source.revision, schemaFingerprint, columns }
}
async function resultFiles(ctx) {
  const dir = path.join(ctx.dataDir, 'dataset-results')
  const files = await fs.readdir(dir).catch(error => { if (error.code === 'ENOENT') return []; throw storageUnavailable() })
  return files.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => path.join(dir, name))
}
async function cleanupResults(ctx, requiredBytes, limits) {
  const now = Date.now()
  let bytes = 0, count = 0
  for (const file of await resultFiles(ctx)) {
    const stat = await fs.stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw storageUnavailable() })
    if (!stat) continue
    if (now - stat.mtimeMs > resultLifetimeMs) {
      await fs.rm(file, { force: true }).catch(() => { throw storageUnavailable() })
    } else { bytes += stat.size; count++ }
  }
  if (requiredBytes > limits.maxResultBytes || bytes + requiredBytes > limits.maxResultCacheBytes
    || count + 1 > limits.maxResultFiles) {
    throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, '查询结果缓存已满，请稍后重试')
  }
}
async function purgeSourceResults(ctx, sourceId) {
  for (const file of await resultFiles(ctx)) {
    let record
    try { record = JSON.parse(await fs.readFile(file, 'utf8')) }
    catch (error) {
      if (error.code === 'ENOENT') continue
      if (!(error instanceof SyntaxError)) throw storageUnavailable()
    }
    if (!record || record.sourceId === sourceId) {
      await fs.rm(file, { force: true }).catch(() => { throw storageUnavailable() })
    }
  }
}
function sqlIdentifier(value) { return `"${value.replaceAll('"', '""')}"` }
function sqlValue(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new Error('筛选值只支持字符串、数字、布尔值和 null')
}
async function resultRecord(ctx, resourceId) {
  const file = resultFile(ctx, resourceId)
  let record
  try { record = JSON.parse(await fs.readFile(file, 'utf8')) }
  catch (error) {
    if (error.code === 'ENOENT') throw new AppServiceError(APP_ERROR_CODES.notFound, '结果引用不存在或已过期')
    throw storageUnavailable()
  }
  if (!record || typeof record !== 'object' || !sourceIdPattern.test(record.sourceId)
    || !Number.isSafeInteger(record.createdAt) || !Array.isArray(record.rows)) throw storageUnavailable()
  return record
}
export function querySql(source, columns, input) {
  const allowed = new Set(columns.map(column => column.name))
  const selected = input.columns?.length ? input.columns : columns.map(column => column.name)
  if (!Array.isArray(selected) || selected.length > 100 || selected.some(name => typeof name !== 'string' || !allowed.has(name))) throw new Error('查询列不在数据源中')
  const filters = input.filters || []
  if (!Array.isArray(filters) || filters.length > 20) throw new Error('筛选条件过多')
  const operations = { eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' }
  const conditions = filters.map(filter => {
    if (!filter || typeof filter !== 'object' || !allowed.has(filter.column) || !Object.hasOwn(operations, filter.op)) throw new Error('筛选条件无效')
    if (filter.value === null) {
      if (!['eq', 'ne'].includes(filter.op)) throw new Error('null 只能用于等于或不等于筛选')
      return `${sqlIdentifier(filter.column)} IS ${filter.op === 'ne' ? 'NOT ' : ''}NULL`
    }
    return `${sqlIdentifier(filter.column)} ${operations[filter.op]} ${sqlValue(filter.value)}`
  })
  const limit = input.limit ?? 200, offset = input.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new Error('查询范围无效')
  return `SELECT ${selected.map(sqlIdentifier).join(', ')} FROM (${fileSql(source.path)}) AS dataset${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} LIMIT ${limit} OFFSET ${offset}`
}

export function registerDatasetActions(backend, { queryRows = duckdb, resultLimits = {} } = {}) {
  const limits = { maxResultBytes, maxResultCacheBytes, maxResultFiles, ...resultLimits }
  let sourceMutation = Promise.resolve()
  const mutateSources = action => {
    const result = sourceMutation.then(action)
    sourceMutation = result.catch(() => {})
    return result
  }
  let resultMutation = Promise.resolve()
  const mutateResults = action => {
    const result = resultMutation.then(action)
    resultMutation = result.catch(() => {})
    return result
  }
  backend.registerAction('dataset.sources.add', async ({ path: inputPath }, ctx) => {
    const file = (await existingPaths([inputPath]))[0]
    const format = path.extname(file).toLowerCase()
    if (!supported.has(format)) throw new Error('只支持 CSV、TSV、JSON、JSONL 和 Parquet 文件')
    return mutateSources(async () => {
      const current = await sources(ctx)
      let source = current.find(item => item.path === file)
      if (!source) {
        source = { id: randomUUID(), path: file, name: path.basename(file), format }
        try { await atomic(sourcesFile(ctx), [...current, source]) }
        catch { throw storageUnavailable() }
      }
      return { source: publicSource(source) }
    })
  })
  backend.registerAction('dataset.sources.list', async (_input, ctx) => ({ sources: (await sources(ctx)).map(publicSource) }))
  backend.registerAction('dataset.sources.remove', async ({ sourceId }, ctx) => mutateSources(async () => {
    if (typeof sourceId !== 'string' || !sourceIdPattern.test(sourceId)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, '数据源 ID 无效')
    }
    const current = await sources(ctx)
    const next = current.filter(source => source.id !== sourceId)
    if (next.length === current.length) throw new AppServiceError(APP_ERROR_CODES.notFound, '数据源不存在或已取消共享')
    try { await atomic(sourcesFile(ctx), next) }
    catch { throw storageUnavailable() }
    await mutateResults(() => purgeSourceResults(ctx, sourceId)).catch(error => {
      ctx.log?.('warn', '已取消共享，但清理查询结果缓存失败', { code: error.code })
    })
    return { removed: true }
  }))
  backend.registerAction('dataset.describe', async ({ sourceId }, ctx) => describe(ctx, await sourceById(ctx, sourceId), queryRows))
  backend.registerAction('dataset.preview', async (input, ctx) => {
    const source = await sourceById(ctx, input.sourceId)
    assertRevision(source, input.expectedRevision)
    const description = await describe(ctx, source, queryRows)
    const limit = input.limit ?? 50, offset = input.offset ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10_000) throw new Error('预览范围无效')
    const rows = await queryRows(ctx, querySql(source, description.columns, { limit, offset }), 512 * 1024)
    assertRevision(await sourceById(ctx, source.id), source.revision)
    return { sourceId: source.id, revision: source.revision, schemaFingerprint: description.schemaFingerprint, columns: description.columns, rows, nextOffset: rows.length === limit ? offset + rows.length : null }
  })
  backend.registerAction('dataset.query', async (input, ctx) => {
    const source = await sourceById(ctx, input.sourceId)
    assertRevision(source, input.expectedRevision)
    const description = await describe(ctx, source, queryRows)
    const rows = await queryRows(ctx, querySql(source, description.columns, input), 8 * 1024 * 1024)
    assertRevision(await sourceById(ctx, source.id), source.revision)
    return mutateResults(async () => {
      assertRevision(await sourceById(ctx, source.id), source.revision)
      ctx.signal?.throwIfAborted()
      const resourceId = randomUUID()
      const record = { sourceId: source.id, callerAppId: ctx.source?.callerAppId, callerInstanceId: ctx.source?.callerInstanceId,
        createdAt: Date.now(), rows }
      const bytes = Buffer.byteLength(JSON.stringify(record, null, 2))
      await cleanupResults(ctx, bytes, limits)
      ctx.signal?.throwIfAborted()
      try { await atomic(resultFile(ctx, resourceId), record) }
      catch { throw storageUnavailable() }
      if (ctx.signal?.aborted) {
        await fs.rm(resultFile(ctx, resourceId), { force: true }).catch(() => {})
        ctx.signal.throwIfAborted()
      }
      return { resourceId, sourceId: source.id, revision: source.revision, schemaFingerprint: description.schemaFingerprint, rowCount: rows.length }
    })
  })
  backend.registerAction('dataset.result.read', async ({ resourceId, offset, limit }, ctx) => {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100_000) throw new Error('结果读取范围无效')
    const record = await resultRecord(ctx, resourceId)
    if (record.callerAppId !== ctx.source?.callerAppId || record.callerInstanceId !== ctx.source?.callerInstanceId) {
      throw new AppServiceError(APP_ERROR_CODES.notFound, '结果引用已过期或不属于当前调用方')
    }
    if (Date.now() - record.createdAt > resultLifetimeMs) {
      await fs.rm(resultFile(ctx, resourceId), { force: true }).catch(() => {})
      throw new AppServiceError(APP_ERROR_CODES.notFound, '结果引用已过期或不属于当前调用方')
    }
    await sourceById(ctx, record.sourceId)
    const text = JSON.stringify(record.rows)
    const chunk = text.slice(offset, offset + limit)
    return { text: chunk, nextOffset: offset + chunk.length < text.length ? offset + chunk.length : null }
  })
}
