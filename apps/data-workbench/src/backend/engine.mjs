import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureBinary, existingPaths, run, argv } from '@moss/engine-apps/runtime'
import spec from '../../resources/engine.json' with { type: 'json' }

const modes = ['preview', 'query', 'export', 'raw']
const formats = { csv: 'CSV', json: 'JSON', parquet: 'PARQUET' }
const sqlLiteral = value => "'" + value.replaceAll("'", "''") + "'"
// DuckDB file readers expand glob patterns even when the path is a SQL string literal.
// Quote glob metacharacters as one-character classes so a selected file stays exact.
const literalFilePattern = file => Array.from(file, char => {
  if (char === '*') return '[*]'
  if (char === '?') return '[?]'
  if (char === '[') return '[[]'
  if (char === ']') return '[]]'
  return char
}).join('')
const outputName = value => {
  if (typeof value !== 'string' || !/^[^/\\\0]{1,160}$/.test(value) || value === '.' || value === '..') throw new Error('输出文件名无效')
  return value
}
export const fileSql = file => {
  const extension = path.extname(file).toLowerCase()
  const reader = extension === '.csv' || extension === '.tsv' ? 'read_csv_auto' : extension === '.json' || extension === '.jsonl' || extension === '.ndjson' ? 'read_json_auto' : extension === '.parquet' ? 'read_parquet' : ''
  if (!reader) throw new Error('页面预览支持 CSV、TSV、JSON、JSONL 和 Parquet')
  return 'SELECT * FROM ' + reader + '(' + sqlLiteral(literalFilePattern(file)) + ')'
}
export async function buildCommand(input, directory) {
  if (!input || !modes.includes(input.mode)) throw new Error('请选择数据操作')
  if (input.mode === 'raw') {
    const args = argv(input.args || [])
    if (!args.length) throw new Error('请输入 DuckDB CLI 参数')
    const output = input.outputName ? path.join(directory, outputName(input.outputName)) : null
    if (args.some(arg => arg.includes('{output}')) && !output) throw new Error('请指定输出文件名')
    return { args: args.map(arg => arg.replaceAll('{output}', output || '')), output }
  }
  let sql = input.sql
  if (input.mode === 'preview') {
    const file = (await existingPaths([input.path]))[0]
    const limit = Number(input.limit || 200)
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('预览行数必须在 1–5000 之间')
    sql = fileSql(file) + ' LIMIT ' + limit
  }
  if (typeof sql !== 'string' || !sql.trim() || sql.length > 200000) throw new Error('请输入 SQL')
  let output
  if (input.mode === 'export') {
    const format = formats[input.format]
    if (!format) throw new Error('请选择 CSV、JSON 或 Parquet 格式')
    output = path.join(directory, outputName(input.outputName || '结果.' + input.format))
    sql = 'COPY (' + sql.trim().replace(/;\s*$/, '') + ') TO ' + sqlLiteral(output) + ' (FORMAT ' + format + ')'
  }
  const args = []
  if (input.database) {
    if (typeof input.database !== 'string' || !path.isAbsolute(input.database)) throw new Error('数据库路径必须是绝对路径')
    args.push(input.database)
  }
  args.push('-json', '-c', sql)
  return { args, sql, output }
}

export default {
  id: 'duckdb', spec,
  async catalog({ dataDir, prepare }) {
    if (prepare) await ensureBinary(spec, dataDir)
    return { version: spec.version, modes, formats: Object.keys(formats), fileTypes: ['csv', 'tsv', 'json', 'jsonl', 'ndjson', 'parquet'] }
  },
  async validate(input) { await buildCommand(input, '/tmp/moss-duckdb-validation') },
  async execute(input, ctx) {
    await ctx.progress('准备 DuckDB 引擎')
    const binary = await ensureBinary(spec, ctx.dataDir, ctx.signal)
    const { args, sql, output } = await buildCommand(input, ctx.directory)
    await ctx.record?.({ argv: args, sql })
    await ctx.progress('正在运行查询')
    const execution = await run(binary, args, { signal: ctx.signal, log: ctx.log })
    const artifacts = [], result = { sql: sql || '', text: execution.stdout.slice(0, 200000) }
    if (input.mode === 'query' || input.mode === 'preview') {
      try {
        const rows = JSON.parse(execution.stdout || '[]')
        result.rows = Array.isArray(rows) ? rows.slice(0, 5000) : [rows]
        result.rowCount = Array.isArray(rows) ? rows.length : 1
      } catch { throw new Error('DuckDB 未返回有效 JSON，请检查 SQL 是否返回结果') }
    }
    if (output) {
      const stat = await fs.stat(output).catch(() => null)
      if (!stat?.isFile()) throw new Error('DuckDB 未生成输出文件')
      artifacts.push({ name: path.basename(output), path: output, kind: input.format === 'json' ? 'json' : input.format === 'csv' ? 'text' : 'document' })
      result.bytes = stat.size
    }
    const logFile = path.join(ctx.directory, '查询结果.json')
    await fs.writeFile(logFile, JSON.stringify(result, null, 2))
    artifacts.push({ name: '查询结果.json', path: logFile, kind: 'json' })
    return { argv: args, artifacts, result, message: input.mode === 'export' ? '数据已导出' : '查询完成' }
  },
}
