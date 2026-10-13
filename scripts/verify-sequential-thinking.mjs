// Verify the configuration App through a real isolated Core Host and its declared command.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const definition = JSON.parse(await fs.readFile(path.join(repo, 'mcp-apps/sequential-thinking/app.json'), 'utf8'))
const output = path.join(repo, 'artifacts', definition.id, definition.version)
const archive = path.join(output, `${definition.id}-${definition.version}.zip`)
const previousIndex = process.argv.indexOf('--previous-archive')
const previousArchive = previousIndex < 0 ? undefined : process.argv[previousIndex + 1]
if (previousIndex >= 0 && !previousArchive) throw new Error('--previous-archive requires a ZIP path')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-thinking-config-'))
process.env.MOSS_HOME = path.join(temporary, 'home')
process.env.MOSS_CONFIG_DIR = process.env.MOSS_HOME
const fromCore = relative => import(pathToFileURL(path.join(core, relative)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
const require = createRequire(path.join(core, 'ui/package.json'))
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href)
const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href)
const name = 'sequential-thinking', serverName = 'moss_sequential_thinking'
let runtime, host, instance
const sessions = new Set(), checks = []
const record = message => { checks.push(message); console.log(`PASS ${message}`) }
const start = async () => {
  runtime = new AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath,
    credentialAdapter: new AppCredentialAdapter(process.env.MOSS_HOME), hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
  host = new AppMcpHost({ getRuntime: () => runtime, inspect: inspectDesktopMcpServer })
  for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => host.handle(method, input, context))
  await runtime.initialize()
  await host.refresh()
}
const invoke = (method, input = {}) => runtime.requestHostCapability(definition.id, instance.id, MCP_PROTOCOL, method, input, { timeoutMs: 90_000 })
const connect = async config => {
  const transport = new StdioClientTransport({ command: config.command, args: config.args, env: { ...process.env, ...config.env }, cwd: temporary, stderr: 'pipe' })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr += chunk })
  const client = new Client({ name: 'thinking-config-verification', version: '1.0.0' })
  try { await client.connect(transport, { timeout: 90_000 }) }
  catch (error) { await transport.close(); throw new Error(`${error.message}\n${stderr}`) }
  const session = { client, stderr: () => stderr, close: async () => { await client.close(); sessions.delete(session) } }
  sessions.add(session)
  return session
}
const call = async (session, args) => {
  const result = await session.client.callTool({ name: 'sequentialthinking', arguments: args })
  assert.ok(!result.isError, JSON.stringify(result))
  return result.structuredContent || JSON.parse(result.content.find(item => item.type === 'text').text)
}
try {
  await start()
  if (previousArchive) {
    await installAppArchive(runtime, path.resolve(previousArchive))
    assert.ok((await runtime.getActivePackage(definition.id)).manifest.backend)
    for (let attempt = 0; attempt < 100 && !host.enabledServers([])[serverName]; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(host.enabledServers([])[serverName], 'Previous Backend must register its service before upgrading')
  }
  await installAppArchive(runtime, archive)
  // Archive storage and version activation are separate Host operations, as in Desktop install IPC.
  await runtime.registerInstalled(definition.id, definition.version)
  instance = await runtime.ensureDefaultInstance(definition.id)
  await host.refresh()
  const installed = await runtime.getActivePackage(definition.id)
  assert.deepEqual(installed.manifest.ui.builtin, 'mcp')
  assert.equal(installed.manifest.backend, undefined)
  assert.deepEqual(installed.manifest.mcpApp.runtime, { state: 'session' })
  assert.equal(installed.manifest.toolScope, 'global')
  assert.deepEqual(runtime.installations.listAll().map(item => item.appId), [definition.id])
  const files = Object.keys(JSON.parse(await fs.readFile(path.join(installed.root, 'checksums.json'), 'utf8')))
  assert.ok(files.filter(file => !file.startsWith('source/')).every(file => !/\.(?:[cm]?js|html|css)$/.test(file)))
  const config = host.enabledServers([], temporary)[serverName]
  assert.equal(config.command, 'npx')
  assert.deepEqual(config.args, definition.mcpServers[name].args)
  assert.equal(config.env.DISABLE_THOUGHT_LOGGING, 'true')
  assert.equal(host.serverOwners()[serverName].mcpIdleTimeoutMs, undefined)
  assert.deepEqual(Object.keys(host.enabledServers([])), [serverName])
  if (previousArchive) record('Upgrade replaces the existing Backend with one configuration service under the same App and service names')
  record('Final ZIP registers a global stateful service without an App Backend or opening UI')

  const inspected = await invoke('servers.inspect', { name })
  assert.equal(inspected.servers[0].check.state, 'connected', JSON.stringify(inspected))
  assert.deepEqual(inspected.servers[0].check.tools.map(tool => tool.name), ['sequentialthinking'])
  const first = await connect(config), second = await connect(config)
  const thought = 'Synthetic private verification marker 27184'
  const step = { thought, thoughtNumber: 1, totalThoughts: 4, nextThoughtNeeded: true }
  assert.equal((await call(first, step)).thoughtHistoryLength, 1)
  assert.equal((await call(first, { ...step, thoughtNumber: 2, isRevision: true, revisesThought: 1 })).thoughtHistoryLength, 2)
  assert.deepEqual((await call(first, { ...step, thoughtNumber: 3, branchFromThought: 1, branchId: 'alternative' })).branches, ['alternative'])
  assert.equal((await call(second, step)).thoughtHistoryLength, 1)
  // A settings-page inspection must not replace either conversation's process.
  await invoke('servers.inspect', { name })
  assert.equal((await call(first, { ...step, thoughtNumber: 4, nextThoughtNeeded: false })).thoughtHistoryLength, 4)
  const invalid = await first.client.callTool({ name: 'sequentialthinking', arguments: { ...step, thoughtNumber: 0 } })
  assert.equal(invalid.isError, true)
  assert.ok(!first.stderr().includes(thought)); assert.ok(!second.stderr().includes(thought))
  await first.close(); await second.close()
  const restarted = await connect(config)
  assert.equal((await call(restarted, step)).thoughtHistoryLength, 1)
  await restarted.close()
  record('Pinned npx service supports revisions and branches, isolates histories, suppresses thought logs and resets on restart')

  await invoke('servers.save', { name, previousName: name, enabled: false, config: { ...definition.mcpServers[name], type: 'stdio', disabledTools: ['sequentialthinking'] } })
  const serviceId = host.toolCatalog(definition.id)[0].serviceId
  await runtime.shutdown(); await start()
  assert.equal(host.enabledServers([])[serverName], undefined)
  const restored = (await invoke('servers.list')).servers[0]
  assert.equal(restored.enabled, false)
  assert.deepEqual(restored.config.disabledTools, ['sequentialthinking'])
  assert.equal(host.toolCatalog(definition.id)[0].serviceId, serviceId)
  await invoke('servers.set-enabled', { name, enabled: true })
  assert.equal(host.enabledServers([])[serverName].env.DISABLE_THOUGHT_LOGGING, 'true')
  for (const enabled of [false, true]) {
    await runtime.setAppEnabled(definition.id, enabled); await host.refresh()
    assert.equal(Boolean(host.enabledServers([])[serverName]), enabled)
  }
  await runtime.setAppGrants(definition.id, ['mcp:read'])
  assert.equal(host.enabledServers([])[serverName], undefined)
  await runtime.setAppGrants(definition.id, installed.manifest.permissions); await host.refresh()
  assert.ok(host.enabledServers([])[serverName])
  await runtime.uninstall(definition.id, { deleteData: true, deleteCredentials: true }); await host.refresh()
  assert.equal(host.enabledServers([])[serverName], undefined)
  record('Host restart preserves settings, credentials and service identity; service/App toggles, permission revocation and uninstall gate tools')
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, version: definition.version, packages: [archive], checks }, null, 2) + '\n')
} catch (error) {
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2) + '\n')
  throw error
} finally {
  await Promise.all([...sessions].map(session => session.close().catch(() => {})))
  await runtime?.shutdown()
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
