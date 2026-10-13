// Install the final ZIP in an isolated, real Moss Host and exercise its tools.
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { connect, call } from '../tests/mcp-client.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)), repo = resolve(root, '../..')
const core = process.env.MOSS_CORE_ROOT || resolve(repo, '../moss')
const temporary = await mkdtemp(join(tmpdir(), 'moss-thinking-app-'))
process.env.MOSS_HOME = join(temporary, 'moss-home')
const fromCore = relative => import(pathToFileURL(join(core, relative)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
const manifest = JSON.parse(await readFile(join(root, 'app.moss.json'), 'utf8'))
const output = join(repo, 'artifacts', manifest.id, 'verification', manifest.version)
await mkdir(output, { recursive: true })
const runtime = new AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath,
  credentialAdapter: new AppCredentialAdapter(process.env.MOSS_HOME), hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
let inspections = 0, registrations = 0, legacyReads = 0
const host = new AppMcpHost({ getRuntime: () => runtime, readLegacy: () => { legacyReads++; return {} },
  inspect: (...args) => { inspections++; return inspectDesktopMcpServer(...args) } })
for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => {
  if (method === 'servers.save' && !input.previousName) registrations++
  return host.handle(method, input, context)
})
const serverName = 'moss_sequential_thinking__sequential-thinking'
const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(message)
}
const sessions = []
try {
  await runtime.initialize()
  await installAppArchive(runtime, join(repo, 'artifacts', manifest.id, manifest.version, `${manifest.id}-${manifest.version}.zip`))
  const installed = (await runtime.getActivePackage(manifest.id)).manifest
  assert.deepEqual(installed.navigation, manifest.navigation)
  assert.equal(installed.toolScope, 'global')
  const contributions = await runtime.listContributions({ appId: manifest.id, kinds: ['views', 'settings'] })
  assert.ok(contributions.settings.some(setting => setting.viewId === installed.navigation.viewId))
  assert.ok(contributions.views.some(view => view.localId === installed.navigation.viewId && view.route === '#/settings'))
  await waitFor(() => host.toolCatalog(manifest.id)[0]?.status === 'connected', 'Automatic MCP startup did not complete')
  assert.equal(registrations, 1); assert.equal(legacyReads, 0)
  assert.ok(!runtime.installations.get('moss.mcp'))
  const config = host.enabledServers()[serverName]
  assert.equal(config.command, process.execPath)
  const instance = (await runtime.listInstances(manifest.id))[0]
  const invoke = (method, input = {}) => runtime.invoke(manifest.id, instance.id, method, input, { timeoutMs: 65_000 })
  const ready = await invoke('servers.list')
  assert.equal(ready.ok, true); assert.equal(ready.data.preparation.state, 'ready')
  assert.equal(manifest.navigation.location, 'settings')
  assert.equal(manifest.toolScope, 'global')
  assert.ok(manifest.contributes.settings.some(setting => setting.viewId === manifest.navigation.viewId))
  const guard = join(temporary, 'offline.cjs')
  await writeFile(guard, "require('node:net').Socket.prototype.connect = function () { throw new Error('Network blocked by offline verification') }\n")
  const sessionOptions = { cwd: temporary, env: { NODE_OPTIONS: `--require=${JSON.stringify(guard)}`, npm_config_cache: join(temporary, 'empty-cache') } }
  sessions.push(await connect(config.args[0], config.args.slice(1), sessionOptions), await connect(config.args[0], config.args.slice(1), sessionOptions))
  const tools = (await sessions[0].client.listTools()).tools
  assert.deepEqual(tools.map(tool => tool.name), ['sequentialthinking'])
  const thought = 'Synthetic private verification marker 27184'
  const step = { thought, thoughtNumber: 1, totalThoughts: 3, nextThoughtNeeded: true }
  assert.equal((await call(sessions[0].client, 'sequentialthinking', step)).thoughtHistoryLength, 1)
  assert.equal((await call(sessions[0].client, 'sequentialthinking', { ...step, thoughtNumber: 2, isRevision: true, revisesThought: 1 })).thoughtHistoryLength, 2)
  assert.deepEqual((await call(sessions[0].client, 'sequentialthinking', { ...step, thoughtNumber: 3, branchFromThought: 1, branchId: 'alternative', nextThoughtNeeded: false })).branches, ['alternative'])
  assert.equal((await call(sessions[1].client, 'sequentialthinking', step)).thoughtHistoryLength, 1)
  assert.ok(sessions.every(session => !session.stderr().includes(thought)))
  await Promise.all(sessions.splice(0).map(session => session.close()))

  await runtime.setAppEnabled(manifest.id, false)
  assert.equal(host.enabledServers()[serverName], undefined)
  const before = inspections
  await runtime.setAppEnabled(manifest.id, true)
  await waitFor(() => inspections > before && host.toolCatalog(manifest.id)[0]?.status === 'connected', 'Re-enable did not discover tools')
  assert.equal(registrations, 1)
  sessions.push(await connect(config.args[0], config.args.slice(1), sessionOptions))
  assert.equal((await call(sessions[0].client, 'sequentialthinking', step)).thoughtHistoryLength, 1)
  const report = { passed: true, platform: `${process.platform}-${process.arch}`, version: manifest.version, toolCount: tools.length,
    checks: ['final ZIP installation with settings UI, without MCP App', 'automatic tool discovery without opening UI', 'offline execution with empty PATH/cache', 'real steps, revisions and branches', 'separate connection histories', 'no thought content on stderr', 'App disable/re-enable', 'history resets after process restart'] }
  await writeFile(join(output, 'host.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`PASS ${manifest.id}: settings contributions, ${tools.length} tools, offline execution and background lifecycle`)
} finally {
  await Promise.all(sessions.map(session => session.close().catch(() => {})))
  await runtime.shutdown()
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
