import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { startMcpFixture } from '../tests/http-fixture.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const repo = resolve(root, '../..'), core = process.env.MOSS_CORE_ROOT || resolve(repo, '../moss')
const temporary = await mkdtemp(join(tmpdir(), 'moss-mcp-integration-'))
process.env.MOSS_HOME = join(temporary, 'moss-home')
const fromCore = relative => import(pathToFileURL(join(core, relative)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
const fixture = await startMcpFixture()
const manifest = JSON.parse(await readFile(join(root, 'app.moss.json'), 'utf8'))
const runtime = new AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath, credentialAdapter: new AppCredentialAdapter(process.env.MOSS_HOME), hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
let legacy = { version: 1, servers: {
  'test-http': { enabled: true, config: { type: 'http', url: `${fixture.url}/mcp`, headers: { Authorization: 'Bearer http-test-secret' } } },
  'test-local': { enabled: true, config: { type: 'stdio', command: process.execPath, args: [join(root, 'tests/stdio-fixture.mjs')], env: { FIXTURE_KEY: 'local-test-secret' } } },
  'test-sse': { enabled: false, config: { type: 'sse', url: `${fixture.url}/sse` } },
} }
let reloads = 0
const host = new AppMcpHost({ getRuntime: () => runtime, readLegacy: () => legacy, clearLegacy: () => { legacy = { version: 1, servers: {} } }, onChanged: () => { reloads++; return { resetSessionCount: 1 } }, inspect: inspectDesktopMcpServer,
  authenticate: () => { throw new Error('OAuth is not configured in this fixture') }, clearAuth: () => {} })
for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => host.handle(method, input, context))
try {
  await runtime.initialize()
  await installAppArchive(runtime, join(repo, 'artifacts/moss.mcp', manifest.version, `moss.mcp-${manifest.version}.zip`))
  const instance = (await runtime.listInstances('moss.mcp'))[0]
  const invoke = async (method, input = {}) => {
    const result = await runtime.invoke('moss.mcp', instance.id, method, input, { timeoutMs: 65_000 })
    assert.equal(result.ok, true, result.error?.message)
    return result.data
  }
  let catalog = await invoke('servers.list')
  assert.equal(catalog.servers.length, 3); assert.deepEqual(legacy.servers, {})
  assert.equal(catalog.servers[0].config.headers.Authorization, '')
  for (const name of ['test-http', 'test-local', 'test-sse']) {
    catalog = await invoke('servers.inspect', { name })
    const checked = catalog.servers.find(server => server.name === name)
    assert.equal(checked.check.state, 'connected')
    assert.deepEqual(checked.check.tools.map(tool => tool.name), name === 'test-local' ? ['read_workspace'] : ['search', 'lookup'])
    console.log(`PASS ${name}: real transport, credentials, tool discovery and cleanup`)
  }
  assert.equal(fixture.seen.filter(method => method === 'tools/list').length, 4)
  await invoke('servers.save', { name: 'unavailable', enabled: false, config: { type: 'http', url: `${fixture.url}/unavailable` } })
  const failed = await invoke('servers.inspect', { name: 'unavailable' })
  assert.equal(failed.servers.find(server => server.name === 'unavailable').check.state, 'failed')
  await invoke('servers.remove', { name: 'unavailable' })
  await invoke('servers.set-enabled', { name: 'test-http', enabled: false })
  assert.equal(host.enabledServers()['test-http'], undefined)
  await runtime.setAppEnabled('moss.mcp', false)
  assert.deepEqual(host.enabledServers(), {})
  await runtime.setAppEnabled('moss.mcp', true)
  await host.refresh()
  assert.deepEqual(Object.keys(host.enabledServers()), ['test-local'])
  await invoke('servers.remove', { name: 'test-local' })
  assert.deepEqual(host.enabledServers(), {})
  const vault = await readFile(join(process.env.MOSS_HOME, 'credentials/app-secrets.json'), 'utf8')
  assert.ok(!vault.includes('http-test-secret') && !vault.includes('local-test-secret'))
  const report = { passed: true, transports: ['http', 'stdio', 'sse'], checks: ['archive installation', 'real backend to Host IPC', 'legacy migration', 'masked and encrypted credentials', 'paginated tool discovery', 'connection failure status', 'service and App lifecycle'], reloads }
  const reportDir = join(repo, 'artifacts/moss.mcp/verification', manifest.version)
  await mkdir(reportDir, { recursive: true }); await writeFile(join(reportDir, 'host.json'), JSON.stringify(report, null, 2))
  console.log('PASS real Core runtime: package, migration, secret storage, service/App lifecycle')
} finally { await runtime.shutdown(); await fixture.close(); await rm(temporary, { recursive: true, force: true }) }
