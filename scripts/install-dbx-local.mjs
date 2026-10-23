import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prepareIsolatedDbxProfile } from './dbx-credentials.mjs'

const repo = fileURLToPath(new URL('..', import.meta.url))
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const fromCore = relative => import(pathToFileURL(path.join(core, relative)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { JsonAppStateStore } = await fromCore('packages/app-runtime/src/state/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { MOSS_HOME } = await fromCore('ui/src/moss-home.mjs')
const { APPS_DIR, publishAppFromBuild } = await fromCore('ui/src/app-platform.mjs')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-dbx-local-install-'))
const definition = JSON.parse(await fs.readFile(path.join(repo, 'tool-apps/dbx/app.json'), 'utf8'))
const stateFile = path.join(temporary, 'state.json')
let runtime, client
try {
  const state = JSON.parse(await fs.readFile(path.join(MOSS_HOME, 'app-runtime-state.json'), 'utf8'))
  for (const section of ['installations', 'instances', 'runtimes']) state[section] = Object.fromEntries(
    Object.entries(state[section] || {}).filter(([, entry]) => ['moss.mcp', 'moss.dbx'].includes(entry.appId) && entry.owner?.key === 'host'))
  await fs.writeFile(stateFile, JSON.stringify(state), { mode: 0o600 })
  runtime = new AppRuntimeHost({ rootDir: MOSS_HOME, appsDir: APPS_DIR, stateStore: new JsonAppStateStore(stateFile),
    automaticStartAllowed: () => false, nodeExecutable: process.execPath, credentialAdapter: new AppCredentialAdapter(MOSS_HOME),
    hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
  const host = new AppMcpHost({ getRuntime: () => runtime })
  for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => host.handle(method, input, context))
  await runtime.initialize({ restore: false })
  assert.ok(runtime.getInstallation('moss.mcp')?.enabled, 'Enable MCP management before configuring its DBX service')
  await installAppArchive(runtime, path.join(repo, 'artifacts/moss.dbx', definition.version, `moss.dbx-${definition.version}.zip`), {
    installPackage: packageRoot => publishAppFromBuild(packageRoot, { reason: 'installed', note: 'DBX 本地验证，暂未市场发布' }),
  })
  await runtime.registerInstalled(definition.id, definition.version)
  await host.refresh()
  const manager = host.findServer('dbx')
  assert.ok(manager?.provider.appId === 'moss.mcp', 'Existing DBX service must belong to MCP management')
  assert.ok(!manager.config.type || manager.config.type === 'stdio', 'Existing DBX service must use stdio')
  assert.ok(manager.config.args?.some(value => value.includes('@dbx-app/mcp-server')), 'Refusing to change an unrelated service named dbx')
  const profile = path.join(MOSS_HOME, 'dbx-mcp')
  const expectedEnv = { DBX_DATA_DIR: profile, DBX_SECRET_KEY_FILE: path.join(profile, '.dbx/secret.key') }
  for (const service of [manager, host.findServer('moss_dbx')]) {
    const previous = service.config.env || {}
    assert.ok(!previous.DBX_SECRET_KEY && !previous.DBX_WEB_URL, 'Existing DBX key or Web configuration must not be replaced')
    for (const [name, value] of Object.entries(expectedEnv)) {
      assert.ok(!previous[name] || previous[name] === value, 'Existing DBX data or key configuration must not be replaced')
    }
  }
  const env = prepareIsolatedDbxProfile(profile)
  const configured = []
  for (const [appId, runtimeName] of [['moss.mcp', 'dbx'], ['moss.dbx', 'moss_dbx']]) {
    const service = host.findServer(runtimeName)
    const provider = service.provider
    await runtime.requestHostCapability(appId, provider.instanceId, MCP_PROTOCOL, 'servers.save', {
      name: 'dbx', previousName: 'dbx', enabled: service.enabled,
      config: { ...service.config, env: { ...Object.fromEntries(Object.entries(service.config.env || {}).filter(([name]) => name !== 'MOSS_SESSION_WORKSPACE')), ...env } },
    })
    const config = host.findServer(runtimeName).config
    assert.equal(config.env.DBX_DATA_DIR, env.DBX_DATA_DIR)
    assert.equal(config.env.DBX_SECRET_KEY_FILE, env.DBX_SECRET_KEY_FILE)
    client = new Client({ name: 'moss-dbx-local-installation-check', version: '1.0.0' })
    const transport = new StdioClientTransport({ command: config.command === 'node' ? process.execPath : config.command,
      args: config.args, cwd: temporary, env: { ...process.env, ...config.env, npm_config_offline: 'true' }, stderr: 'pipe' })
    transport.stderr?.resume()
    await client.connect(transport)
    const tools = (await client.listTools()).tools
    const result = await client.callTool({ name: 'dbx_list_connections', arguments: {} })
    assert.ok(!result.isError, JSON.stringify(result))
    configured.push({ appId, runtimeName, tools: tools.length, listConnections: 'passed' })
    await client.close()
  }
  console.log(JSON.stringify({ localInstall: 'passed', installedApp: `${definition.id}@${definition.version}`, configured,
    profile: env.DBX_DATA_DIR, keyFile: env.DBX_SECRET_KEY_FILE, existingDesktopData: 'untouched',
    databaseCredentials: 'not-created', publication: 'not-run', reload: 'Restart Moss or reload MCP services before retrying in an existing session' }, null, 2))
} finally {
  await client?.close()
  await runtime?.shutdown()
  await fs.rm(temporary, { recursive: true, force: true })
}
