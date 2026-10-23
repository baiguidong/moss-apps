// Real ZIP upgrade from the former Backend App, in a temporary Core profile.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const definition = JSON.parse(await fs.readFile(path.join(repo, 'tool-apps/git/app.json'), 'utf8'))
const output = path.join(repo, 'artifacts', definition.id, definition.version)
const archive = path.join(output, `${definition.id}-${definition.version}.zip`)
const previousIndex = process.argv.indexOf('--previous-archive')
const previousArchive = previousIndex < 0 ? undefined : process.argv[previousIndex + 1]
if (previousIndex >= 0 && !previousArchive) throw new Error('--previous-archive requires a ZIP path')
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-git-upgrade-')))
process.env.MOSS_HOME = path.join(temp, 'home'); process.env.MOSS_CONFIG_DIR = process.env.MOSS_HOME
const fromCore = relative => import(pathToFileURL(path.join(core, relative)).href)
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
let runtime, host, instance
const name = 'git', serverName = 'moss_git'
const shared = path.join(temp, '公共目录 #1'), workspace = path.join(temp, 'Workspace')
const start = async () => {
  runtime = new AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath, credentialAdapter: new AppCredentialAdapter(process.env.MOSS_HOME), hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
  host = new AppMcpHost({ getRuntime: () => runtime, inspect: inspectDesktopMcpServer })
  for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => host.handle(method, input, context))
  await runtime.initialize(); await host.refresh()
}
const invoke = (method, input = {}) => runtime.requestHostCapability(definition.id, instance.id, MCP_PROTOCOL, method, input, { timeoutMs: 90_000 })
const checks = []
const record = text => { checks.push(text); console.log(`PASS ${text}`) }
try {
  await fs.mkdir(shared); await fs.mkdir(workspace)
  execFileSync('git', ['init', '-q', shared])
  const gitExecutable = await fs.realpath(execFileSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0])
  await start()
  let identity
  if (previousArchive) {
    await installAppArchive(runtime, path.resolve(previousArchive))
    instance = await runtime.ensureDefaultInstance(definition.id)
    const saved = await runtime.invoke(definition.id, instance.id, 'servers.save', { directories: [shared], disabledTools: ['git_commit'], gitExecutable }, { timeoutMs: 65_000 })
    assert.equal(saved.ok, true, JSON.stringify(saved))
    await invoke('servers.set-enabled', { name, enabled: false })
    identity = host.toolCatalog(definition.id)[0].serviceId
  }
  await installAppArchive(runtime, archive)
  await runtime.registerInstalled(definition.id, definition.version)
  instance = await runtime.ensureDefaultInstance(definition.id); await host.refresh()
  const installed = await runtime.getActivePackage(definition.id)
  assert.equal(installed.manifest.ui.builtin, 'mcp'); assert.equal(installed.manifest.backend, undefined)
  assert.equal(installed.manifest.hostApi, '^3.11.0')
  assert.deepEqual(host.enabledServers([]), {})
  let server = (await invoke('servers.list')).servers[0]
  assert.equal(server.config.command, 'python3')
  assert.deepEqual(server.config.python, definition.mcpServers.git.python)
  assert.deepEqual(server.config.args, definition.mcpServers.git.args)
  if (previousArchive) {
    assert.equal(server.enabled, false)
    assert.equal(server.config.pathBindings[0].executable, gitExecutable)
    assert.deepEqual(server.config.roots.directories, [shared])
    assert.deepEqual(server.config.disabledTools, ['git_commit'])
    assert.equal(host.toolCatalog(definition.id)[0].serviceId, identity)
    record('Legacy Backend upgrade preserves public repositories, Git executable, disabled tools, disabled state and service identity')
  }
  await invoke('servers.save', { name, previousName: name, enabled: true, config: { ...server.config, roots: { ...server.config.roots, directories: [shared] }, disabledTools: ['git_commit'] } })
  const inspected = (await invoke('servers.inspect', { name })).servers[0]
  assert.equal(inspected.check.state, 'connected', JSON.stringify(inspected))
  assert.equal(inspected.check.tools.length, 12)
  assert.equal(inspected.check.tools.find(tool => tool.name === 'git_commit').disabled, true)
  assert.equal(host.enabledServers([definition.id], workspace)[serverName].env.MOSS_SESSION_WORKSPACE, workspace)
  assert.equal(host.findServer(serverName).config.env.MOSS_SESSION_WORKSPACE, '')
  record('Real pinned server exposes 12 tools and binds only session launches to the session workspace')
  const invalid = { ...server.config, roots: { ...server.config.roots, directories: [path.join(temp, 'missing')] } }
  await assert.rejects(invoke('servers.save', { name, previousName: name, enabled: true, config: invalid }), /目录不存在/)
  assert.deepEqual((await invoke('servers.list')).servers[0].config.roots.directories, [shared])
  await runtime.shutdown(); await start()
  server = (await invoke('servers.list')).servers[0]
  assert.deepEqual(server.config.roots.directories, [shared]); assert.deepEqual(server.config.disabledTools, ['git_commit'])
  if (previousArchive) assert.equal(server.config.pathBindings[0].executable, gitExecutable)
  await invoke('servers.save', { name, previousName: name, enabled: true, config: { ...server.config, roots: { ...server.config.roots, directories: [] } } })
  assert.equal((await invoke('servers.inspect', { name })).servers[0].check.state, 'connected')
  await assert.rejects(invoke('servers.save', { name, previousName: name, enabled: true, config: { ...server.config, pathBindings: [{ ...server.config.pathBindings[0], executable: path.join(temp, 'missing-git') }] } }), /未找到 Git/)
  record('Invalid directories preserve prior settings; restart preserves user settings; empty scope still permits tool inspection')
  await runtime.setAppEnabled(definition.id, false)
  assert.deepEqual(host.enabledServers([definition.id]), {})
  await runtime.setAppEnabled(definition.id, true); await host.refresh()
  await runtime.setAppGrants(definition.id, ['mcp:read'])
  assert.deepEqual(host.enabledServers([definition.id]), {})
  await runtime.uninstall(definition.id, { deleteData: true, deleteCredentials: true }); await host.refresh()
  assert.deepEqual(host.enabledServers([definition.id]), {})
  record('App disablement, permission revocation and uninstall remove access')
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, packages: [archive], checks }, null, 2) + '\n')
} catch (error) {
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2) + '\n'); throw error
} finally { await runtime?.shutdown(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
