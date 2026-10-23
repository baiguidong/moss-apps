import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { randomBytes, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { extractAppArchive } from '../vendor/moss-core/ui/src/apps/app-runtime.mjs'
import { validateAppPackage } from '../vendor/moss-core/packages/app-runtime/src/packages/index.mjs'
import { repoRoot, selectApps, optionValue } from './lib.mjs'

const app = selectApps(['--app', 'moss.dbx'])[0]
const archive = path.resolve(optionValue(process.argv.slice(2), '--package') || path.join(repoRoot, 'artifacts', app.manifest.id, app.manifest.version, `${app.manifest.id}-${app.manifest.version}.zip`))
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-dbx-verification-'))
let client
try {
  const root = path.join(temporary, 'Moss DBX 测试')
  await extractAppArchive(archive, root)
  await validateAppPackage(root)
  const config = JSON.parse(await fs.readFile(path.join(root, 'mcp.json'), 'utf8')).mcpServers.dbx
  assert.equal(config.command, 'node')
  assert.equal(config.args[1], '--stdio')
  const launcher = path.join(root, config.args[0].slice('@app/'.length))
  const source = await fs.readFile(launcher, 'utf8')
  const nativeRoot = path.join(root, 'runtime/native')
  const provenance = JSON.parse(await fs.readFile(path.join(nativeRoot, 'provenance.json'), 'utf8'))
  for (const entry of provenance.files) {
    const bytes = await fs.readFile(path.join(nativeRoot, entry.path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256)
    const platform = entry.path.split('/')[0]
    const bundled = await fs.readFile(path.join(root, 'runtime/node_modules/@dbx-app', `mcp-${platform}`, 'bin/vcruntime140.dll'))
    assert.deepEqual(bundled, bytes)
    assert.equal(bytes.readUInt16LE(bytes.readUInt32LE(60) + 4), platform.endsWith('arm64') ? 0xaa64 : 0x8664)
  }
  const upstreamRequire = createRequire(launcher)
  const targets = [
    ['darwin', 'arm64', '@dbx-app/mcp-darwin-arm64', 'dbx-mcp', 'Mach-O', 0x0100000c],
    ['darwin', 'x64', '@dbx-app/mcp-darwin-x64', 'dbx-mcp', 'Mach-O', 0x01000007],
    ['linux', 'arm64', '@dbx-app/mcp-linux-arm64-gnu', 'dbx-mcp', 'ELF', 183],
    ['linux', 'x64', '@dbx-app/mcp-linux-x64-gnu', 'dbx-mcp', 'ELF', 62],
    ['win32', 'arm64', '@dbx-app/mcp-win32-arm64', 'dbx-mcp.exe', 'PE', 0xaa64],
    ['win32', 'x64', '@dbx-app/mcp-win32-x64', 'dbx-mcp.exe', 'PE', 0x8664],
  ]
  const platforms = []
  for (const [platform, arch, name, filename, format, machine] of targets) {
    const manifestPath = upstreamRequire.resolve(`${name}/package.json`)
    assert.equal(JSON.parse(await fs.readFile(manifestPath, 'utf8')).version, '0.4.127')
    const binary = path.join(path.dirname(manifestPath), 'bin', filename)
    const selected = []
    vm.runInNewContext(source.replace(/^import .*;$/gm, '').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(launcher).href)), {
      createRequire: () => upstreamRequire, existsSync, dirname: path.dirname, join: path.join,
      process: { platform, arch, argv: ['node', launcher, '--stdio'], env: {}, on() {}, exit(code) { throw new Error(`Launcher exited: ${code}`) } },
      console: { error(message) { throw new Error(message) } },
      spawn(command, args, options) { selected.push({ command, args, options }); return new EventEmitter() },
    })
    assert.equal(selected[0].command, binary)
    assert.deepEqual(Array.from(selected[0].args), ['--stdio'])
    assert.equal(selected[0].options.stdio, 'inherit')
    assert.equal(selected[0].options.windowsHide, true)
    const file = await fs.open(binary, 'r')
    try {
      const header = Buffer.alloc(64)
      await file.read(header, 0, header.length, 0)
      if (format === 'ELF') {
        assert.equal(header.subarray(0, 4).toString('hex'), '7f454c46')
        assert.equal(header.readUInt16LE(18), machine)
      } else if (format === 'Mach-O') {
        assert.equal(header.readUInt32LE(0), 0xfeedfacf)
        assert.equal(header.readUInt32LE(4), machine)
      } else {
        assert.equal(header.subarray(0, 2).toString(), 'MZ')
        const signature = Buffer.alloc(6)
        await file.read(signature, 0, signature.length, header.readUInt32LE(60))
        assert.equal(signature.readUInt32LE(0), 0x00004550)
        assert.equal(signature.readUInt16LE(4), machine)
      }
    } finally { await file.close() }
    if (process.platform !== 'win32' && platform !== 'win32') assert.ok((await fs.stat(binary)).mode & 0o100)
    platforms.push({ platform: `${platform}-${arch}`, format, launcher: 'verified', binary: 'verified' })
  }
  await fs.rm(path.join(root, 'source'), { recursive: true, force: true })
  const home = path.join(temporary, 'home')
  const data = path.join(temporary, 'isolated-data')
  await fs.mkdir(home)
  await fs.mkdir(data)
  const env = { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_DATA_HOME: home, XDG_CONFIG_HOME: home,
    DBX_DATA_DIR: data, DBX_SECRET_KEY_FILE: path.join(data, 'test-secret.key'),
    PATH: path.dirname(process.execPath), NODE_PATH: '', npm_config_offline: 'true',
    npm_config_registry: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name]
  await fs.writeFile(env.DBX_SECRET_KEY_FILE, randomBytes(32).toString('hex') + '\n', { mode: 0o600 })
  const connect = async () => {
    client = new Client({ name: 'moss-dbx-offline-verification', version: '1.0.0' })
    const transport = new StdioClientTransport({ command: process.execPath, args: [launcher, '--stdio'], cwd: data, env, stderr: 'pipe' })
    transport.stderr?.resume()
    await client.connect(transport)
    return client
  }
  const timeout = setTimeout(() => { void client?.close(); process.exitCode = 1 }, 60000)
  try {
    await connect()
    const tools = (await client.listTools()).tools.map(tool => tool.name)
    for (const name of ['dbx_list_connections', 'dbx_list_tables', 'dbx_execute_query']) assert.ok(tools.includes(name), `Missing tool: ${name}`)
    const result = await client.callTool({ name: 'dbx_list_connections', arguments: {} })
    assert.ok(!result.isError, JSON.stringify(result))
    assert.match(JSON.stringify(result.content), /No connections configured/)
    const password = randomBytes(24).toString('hex')
    const saved = await client.callTool({ name: 'dbx_add_connection', arguments: {
      name: 'credential-verification', db_type: 'postgres', host: '127.0.0.1', port: 1,
      username: 'isolated-test', password,
    } })
    assert.ok(!saved.isError, JSON.stringify(saved))
    assert.match(JSON.stringify(saved.content), /added \(id:/)
    await client.close()
    const metadata = new DatabaseSync(path.join(data, 'dbx.db'), { readOnly: true })
    try {
      const secrets = metadata.prepare('SELECT secret, secret_enc FROM connection_secrets').all()
      assert.ok(secrets.length > 0, 'Saved connection must have encrypted credentials')
      assert.ok(secrets.some(row => typeof row.secret_enc === 'string' && row.secret_enc.startsWith('dbxenc1')))
      assert.ok(secrets.every(row => row.secret !== password && !String(row.secret_enc).includes(password)))
    } finally { metadata.close() }
    env.DBX_MCP_ALLOW_WRITES = '0'
    await connect()
    const persisted = await client.callTool({ name: 'dbx_list_connections', arguments: {} })
    assert.ok(!persisted.isError, JSON.stringify(persisted))
    assert.match(JSON.stringify(persisted.content), /credential-verification/)
    const blocked = await client.callTool({ name: 'dbx_add_connection', arguments: {
      name: 'must-not-save', db_type: 'postgres', host: '127.0.0.1', port: 1,
    } })
    assert.equal(blocked.isError, true)
    assert.match(JSON.stringify(blocked.content), /MCP_READ_ONLY/)
    const verification = { appId: app.manifest.id, version: app.manifest.version, upstreamVersion: '0.4.127',
      platforms, executedPlatform: `${process.platform}-${process.arch}`, tools: tools.length,
      windowsRuntime: { version: provenance.version, architectures: ['arm64', 'x64'], checksums: 'verified' },
      listConnections: 'passed-isolated-empty-data', credentials: 'saved-encrypted-and-readable-after-restart',
      readOnly: 'blocks-connection-management', sourceRemoved: true, externalDownloads: 'not-used',
      notes: 'Other platform binaries and launcher selection are inspected, not executed. Linux requires glibc >=2.30; Windows 10/11 supplies UCRT.' }
    const report = path.join(path.dirname(archive), 'verification.json')
    await fs.writeFile(report, JSON.stringify(verification, null, 2) + '\n')
    console.log(JSON.stringify(verification, null, 2))
  } finally { clearTimeout(timeout) }
} finally {
  await client?.close()
  await fs.rm(temporary, { recursive: true, force: true })
}
