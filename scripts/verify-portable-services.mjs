// Run one real upstream MCP tool on the current OS before publishing a portable ZIP.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prepareMcpPython } from '../vendor/moss-core/packages/app-sdk/src/mcp/python-runtime.mjs'
import { DatabaseService, defaults } from '../apps/database/src/backend/service.mjs'

const appId = process.argv[process.argv.indexOf('--app') + 1]
const supported = new Set(['moss.database', 'moss.excel', 'moss.markitdown'])
if (!supported.has(appId)) throw new Error(`Unsupported portable service: ${appId}`)
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-portable-service-'))
let client
try {
  let config
  if (appId === 'moss.database') {
    const file = path.join(root, 'test.sqlite')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE records (value INTEGER NOT NULL); INSERT INTO records VALUES (42)')
    db.close()
    let saved
    const service = new DatabaseService(async (method, input) => {
      if (method === 'servers.save') saved = input
      return { servers: saved ? [{ name: saved.name, enabled: true, config: saved.config }] : [] }
    })
    await service.run('save', { ...defaults, title: 'Cross-platform SQLite', kind: 'sqlite', file },
      { dataDir: root, signal: new AbortController().signal })
    config = saved.config
    assert.equal(config.command, process.platform === 'win32' ? 'cmd' : 'npx')
  } else {
    const name = appId.slice('moss.'.length)
    const manifest = JSON.parse(await fs.readFile(new URL(`../mcp-apps/${name}/app.json`, import.meta.url), 'utf8'))
    config = structuredClone(manifest.mcpServers[name])
    if (name === 'excel') config.args[config.args.indexOf('--allow-dir') + 1] = root
    const env = { ...process.env, ...config.env,
      MOSS_HOME: root, MOSS_MCP_PYTHON_HOME: path.join(root, 'python'),
      MOSS_PYTHON_PATH: process.env.MOSS_PYTHON_PATH || 'python' }
    config.command = await prepareMcpPython(config, { env })
  }
  const transport = new StdioClientTransport({ command: config.command, args: config.args,
    env: { ...process.env, ...config.env }, cwd: root, stderr: 'pipe' })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-5000) })
  client = new Client({ name: 'moss-portable-service-check', version: '1.0.0' })
  try { await client.connect(transport, { timeout: 300_000 }) }
  catch (error) { throw new Error(`${error.message}\n${stderr}`) }
  const names = new Set((await client.listTools()).tools.map(tool => tool.name))
  const call = async (name, args) => {
    assert(names.has(name), `Missing MCP tool ${name}`)
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 })
    const content = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n')
    assert(!result.isError, `${name}: ${content}`)
    return content
  }
  if (appId === 'moss.database') {
    assert.match(await call('execute_sql', { sql: 'SELECT value FROM records' }), /42/)
  } else if (appId === 'moss.excel') {
    await call('create_workbook', { path: 'portable.xlsx', sheets: ['Sheet1'] })
    await call('write_range', { path: 'portable.xlsx', sheet: 'Sheet1', at: 'A1', rows: [[42]] })
    assert.match(await call('read_range', { path: 'portable.xlsx', sheet: 'Sheet1', range: 'A1' }), /42/)
  } else {
    const file = path.join(root, 'portable.txt')
    await fs.writeFile(file, 'Moss portable conversion 42\n')
    assert.match(await call('convert_to_markdown', { uri: pathToFileURL(file).href }), /Moss portable conversion 42/)
  }
  console.log(`PASS ${appId}: ${process.platform}-${process.arch}, ${names.size} tools, real MCP call`)
} finally {
  await client?.close().catch(error => console.warn(`MCP cleanup: ${error.message}`))
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch(error => console.warn(`Temporary directory cleanup: ${error.message}`))
}
