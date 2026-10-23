import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prepareIsolatedDbxProfile } from './dbx-credentials.mjs'

const repo = fileURLToPath(new URL('..', import.meta.url))
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const fromCore = relative => import(pathToFileURL(path.join(core, relative)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-dbx-host-'))
const rootDir = path.join(temporary, 'moss-home')
const env = prepareIsolatedDbxProfile(path.join(temporary, '独立 DBX'))
const definition = JSON.parse(await fs.readFile(path.join(repo, 'tool-apps/dbx/app.json'), 'utf8'))
const managerManifest = JSON.parse(await fs.readFile(path.join(repo, 'apps/mcp/app.moss.json'), 'utf8'))
const managerPackage = process.env.MOSS_MCP_MANAGER_PACKAGE || path.join(os.homedir(), '.moss/apps/moss.mcp/versions', managerManifest.version)
const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('DBX_')))
let runtime, host, client
const start = async () => {
  runtime = new AppRuntimeHost({ rootDir, nodeExecutable: process.execPath, automaticStartAllowed: () => false,
    credentialAdapter: new AppCredentialAdapter(rootDir), hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
  host = new AppMcpHost({ getRuntime: () => runtime })
  for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => host.handle(method, input, context))
  await runtime.initialize({ restore: false })
  await host.refresh()
}
const request = async (appId, method, input = {}) => {
  const instance = await runtime.ensureDefaultInstance(appId)
  return runtime.requestHostCapability(appId, instance.id, MCP_PROTOCOL, method, input)
}
const connect = async config => {
  client = new Client({ name: 'moss-dbx-host-verification', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: config.command === 'node' ? process.execPath : config.command,
    args: config.args, env: { ...inheritedEnv, ...config.env }, stderr: 'pipe' })
  transport.stderr?.resume()
  await client.connect(transport)
}
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args })
  assert.ok(!result.isError, JSON.stringify(result))
  return JSON.stringify(result.content)
}
try {
  const sample = path.join(temporary, 'sample.sqlite')
  const database = new DatabaseSync(sample)
  database.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('DBX host verified');")
  database.close()
  await start()
  await runtime.installFromDirectory(managerPackage)
  await installAppArchive(runtime, path.join(repo, 'artifacts/moss.dbx', definition.version, `moss.dbx-${definition.version}.zip`))
  await host.refresh()
  const bundled = host.findServer('moss_dbx').config
  const upstream = createRequire(bundled.args[0]).resolve('@dbx-app/mcp-server/bin/dbx-mcp-server.js')
  const configs = {
    'moss.mcp': { type: 'stdio', command: process.execPath, args: [upstream, '--stdio'], env },
    'moss.dbx': { ...bundled, env },
  }
  for (const [appId, config] of Object.entries(configs)) {
    await request(appId, 'servers.save', { name: 'dbx', ...(appId === 'moss.dbx' ? { previousName: 'dbx' } : {}), enabled: true, config })
    const listed = await request(appId, 'servers.list')
    const server = listed.servers.find(entry => entry.name === 'dbx')
    assert.equal(server.config.env.DBX_DATA_DIR, '')
    assert.equal(server.config.env.DBX_SECRET_KEY_FILE, '')
  }
  await connect(host.findServer('dbx').config)
  const added = await call('dbx_add_connection', { name: 'local-sqlite-test', db_type: 'sqlite', host: sample, port: 0 })
  assert.match(added, /added \(id:/)
  assert.match(await call('dbx_execute_query', { connection_name: 'local-sqlite-test', sql: 'SELECT value FROM sample' }), /DBX host verified/)
  await client.close()
  await runtime.shutdown()
  await start()
  await connect(host.findServer('moss_dbx').config)
  assert.match(await call('dbx_list_connections', {}), /local-sqlite-test/)
  assert.match(await call('dbx_execute_query', { connection_name: 'local-sqlite-test', sql: 'SELECT value FROM sample' }), /DBX host verified/)
  await client.close()
  assert.match(await fs.readFile(path.join(rootDir, 'credentials/app-secrets.json'), 'utf8'), /encryption/)
  console.log(JSON.stringify({ passed: true, apps: Object.keys(configs), checks: ['real Core ZIP installation', 'both entry points pass env',
    'original MCP adds connection', 'SQLite query', 'persisted credentials after Host restart', 'masked paths in App responses'] }, null, 2))
} finally {
  await client?.close()
  await runtime?.shutdown()
  await fs.rm(temporary, { recursive: true, force: true })
}
