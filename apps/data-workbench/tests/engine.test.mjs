import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildCommand, fileSql } from '../src/backend/engine.mjs'
import { querySql } from '../src/backend/dataset.mjs'

const bundledBinary = fileURLToPath(new URL('../dist/engines/duckdb/1.5.6/duckdb', import.meta.url))
const duckdbBinary = process.env.MOSS_TEST_DUCKDB || bundledBinary
const canRunDuckDB = existsSync(duckdbBinary) && (process.env.MOSS_TEST_DUCKDB || process.platform === 'darwin' && process.arch === 'arm64')
const quote = value => "'" + value.replaceAll("'", "''") + "'"
const rowsFor = sql => JSON.parse(execFileSync(duckdbBinary, ['-json', '-c', sql], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }) || '[]')

test('file preview quotes path and export writes inside task directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-duckdb-'))
  try {
    const file = path.join(root, "数据'表.csv")
    await fs.writeFile(file, 'id\n1\n')
    const preview = await buildCommand({ mode: 'preview', path: file, limit: 10 }, root)
    assert.match(preview.sql, /数据''表\.csv/)
    assert.match(preview.sql, /LIMIT 10$/)
    const exported = await buildCommand({ mode: 'export', sql: 'SELECT 1 AS id;', format: 'parquet', outputName: '结果.parquet' }, root)
    assert.equal(exported.output, path.join(root, '结果.parquet'))
    await assert.rejects(buildCommand({ mode: 'raw', args: ['{output}'] }, root), /输出文件名/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('literal shared file paths never expand adjacent files across all readers', { skip: !canRunDuckDB }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-duckdb-glob-'))
  try {
    const directory = path.join(root, "folder[one]?'")
    await fs.mkdir(directory)
    for (const extension of ['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'parquet']) {
      const selected = path.join(directory, 'shared*.' + extension)
      const adjacent = path.join(directory, 'shared-secret.' + extension)
      if (extension === 'parquet') {
        for (const [file, value] of [[selected, 'public'], [adjacent, 'SECRET']]) {
          execFileSync(duckdbBinary, ['-c', 'COPY (SELECT ' + quote(value) + ' AS value) TO ' + quote(file) + ' (FORMAT PARQUET)'])
        }
      } else {
        const content = value => extension.startsWith('json') || extension === 'ndjson'
          ? JSON.stringify({ value }) + '\n' : 'value\n' + value + '\n'
        await Promise.all([fs.writeFile(selected, content('public')), fs.writeFile(adjacent, content('SECRET'))])
      }
      const rows = rowsFor('SELECT value FROM (' + fileSql(selected) + ')')
      assert.deepEqual(rows, [{ value: 'public' }], extension)
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('structured query quotes column names and filter values', { skip: !canRunDuckDB }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-duckdb-query-'))
  try {
    const file = path.join(root, 'quoted.csv')
    await fs.writeFile(file, '"a""b"\npublic\nsecret\n')
    const source = { path: file }
    const columns = [{ name: 'a"b' }]
    const input = value => ({ columns: ['a"b'], filters: [{ column: 'a"b', op: 'eq', value }] })
    assert.deepEqual(rowsFor(querySql(source, columns, input('public'))), [{ 'a"b': 'public' }])
    assert.deepEqual(rowsFor(querySql(source, columns, input("public' OR TRUE --"))), [])
    for (const op of ['constructor', '__proto__']) {
      assert.throws(() => querySql(source, columns, { filters: [{ column: 'a"b', op, value: 'public' }] }), /筛选条件无效/)
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
