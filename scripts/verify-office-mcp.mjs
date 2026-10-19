// Exercise generated ZIPs through the real Core host and upstream stdio servers.
// All workbooks, documents, databases, credentials and installed Apps are temporary.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { unzipSync } from 'fflate'
import { prepareMcpPython } from '../vendor/moss-core/packages/app-sdk/src/mcp/python-runtime.mjs'
import { resolveMcpLaunchConfig } from '../vendor/moss-core/ui/src/apps/mcp-launch-config.mjs'

const execute = promisify(execFile)
const repo = fileURLToPath(new URL('..', import.meta.url))
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const requested = process.argv.indexOf('--app')
const selector = requested < 0 ? '' : process.argv[requested + 1]
const apps = ['markitdown', 'excel'].filter(name => !selector || [name, `moss.${name}`].includes(selector))
// Database now owns its dynamic connection UI and Backend acceptance.
if (!selector || ['database', 'moss.database'].includes(selector)) {
  const result = await execute(process.execPath, [path.join(repo, 'apps/database/scripts/verify-ui.mjs')], { timeout: 360000, maxBuffer: 2 * 1024 * 1024 })
  process.stdout.write(result.stdout)
  if (!apps.length) process.exit(0)
}
assert(apps.length && (requested < 0 || selector), 'Use --app moss.markitdown, moss.excel or moss.database')
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-office-mcp-')))
// Cache only public runtime dependencies across test invocations.
process.env.MOSS_MCP_PYTHON_HOME ||= path.join(repo, '.cache/mcp-office-research/python')
process.env.npm_config_cache ||= path.join(repo, '.cache/mcp-office-research/npm')
process.env.MOSS_HOME = path.join(temp, 'profile')
process.env.MOSS_CONFIG_DIR = process.env.MOSS_HOME
const fromCore = relative => import(pathToFileURL(path.join(core, relative)).href)
if (!process.env.MOSS_PYTHON_PATH) {
  const { MANAGED_RUNTIME_VERSIONS } = await fromCore('ui/src/runtime/runtime-manifest.mjs')
  const root = path.join(process.env.MOSS_TEST_RUNTIME_HOME || path.join(os.homedir(), '.moss/runtimes'), 'python', 'versions', MANAGED_RUNTIME_VERSIONS.python)
  for (const relative of ['bin/python3', 'install/bin/python3', 'python.exe', 'install/python.exe']) {
    const candidate = path.join(root, relative)
    if (await fs.access(candidate).then(() => true, () => false)) { process.env.MOSS_PYTHON_PATH = candidate; break }
  }
}
const coreRequire = createRequire(path.join(core, 'package.json'))
const { Client } = coreRequire('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = coreRequire('@modelcontextprotocol/sdk/client/stdio.js')
const { AppRuntimeHost } = await fromCore('packages/app-runtime/src/host/index.mjs')
const { AppCredentialAdapter, installAppArchive } = await fromCore('ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await fromCore('ui/src/apps/app-mcp-host.mjs')
const { inspectDesktopMcpServer } = await fromCore('ui/electron-direct.mjs')
let runtime, host
const clients = new Set()
const start = async () => {
  runtime = new AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath,
    credentialAdapter: new AppCredentialAdapter(process.env.MOSS_HOME),
    hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
  host = new AppMcpHost({ getRuntime: () => runtime, inspect: inspectDesktopMcpServer })
  for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => host.handle(method, input, context))
  await runtime.initialize()
  await host.refresh()
}
const text = result => (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n')
const call = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 })
  assert(!result.isError, `${name}: ${text(result)}`)
  return result
}
async function open(config, workspace) {
  const launch = resolveMcpLaunchConfig(config, { workspace })
  const env = { ...process.env, ...launch.env }
  const command = await prepareMcpPython(launch, { env })
  const transport = new StdioClientTransport({ command, args: launch.args, env, cwd: workspace, stderr: 'pipe' })
  let stderr = ''
  transport.stderr?.on('data', data => { stderr = (stderr + data).slice(-8000) })
  const client = new Client({ name: 'moss-office-verification', version: '1.0.0' })
  clients.add(client)
  try { await client.connect(transport, { timeout: 120_000 }) }
  catch (error) { await client.close(); clients.delete(client); throw new Error(`MCP connection failed: ${error.message}\n${stderr}`) }
  return { client, command, close: async () => { await client.close(); clients.delete(client) } }
}

const fixturePython = String.raw`
import sys, pathlib, zipfile
from openpyxl import Workbook
from pptx import Presentation
p=pathlib.Path(sys.argv[1])
w=Workbook(); w.active.append(['Item','Amount']); w.active.append(['Moss spreadsheet fixture',42]); w.save(p/'表格 #1.xlsx')
with zipfile.ZipFile(p/'文档 #1.docx','w') as z:
 z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Moss document fixture 中文内容</w:t></w:r></w:p></w:body></w:document>')
r=Presentation(); slide=r.slides.add_slide(r.slide_layouts[0]); slide.shapes.title.text='Moss presentation fixture'; r.save(p/'演示 #1.pptx')
stream=b'BT /F1 12 Tf 72 720 Td (Moss PDF fixture 42) Tj ET'
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
data=b'%PDF-1.4\n'; offsets=[0]
for i,obj in enumerate(objects,1):
 offsets.append(len(data)); data+=str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
xref=len(data); data+=b'xref\n0 6\n0000000000 65535 f \n'
for offset in offsets[1:]: data+=f'{offset:010d} 00000 n \n'.encode()
data+=b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(xref).encode()+b'\n%%EOF\n'
(p/'文档 #1.pdf').write_bytes(data)
`

try {
  await start()
  for (const name of apps) {
    const definition = JSON.parse(await fs.readFile(path.join(repo, 'mcp-apps', name, 'app.json'), 'utf8'))
    const output = path.join(repo, 'artifacts', definition.id, definition.version)
    const archive = path.join(output, `${definition.id}-${definition.version}.zip`)
    const checks = []
    const record = value => { checks.push(value); console.log(`PASS ${definition.id}: ${value}`) }
    let connection, database
    const workspace = path.join(temp, name, '工作目录 #1')
    await fs.mkdir(workspace, { recursive: true })
    try {
      await installAppArchive(runtime, archive)
      await runtime.registerInstalled(definition.id, definition.version)
      const instance = await runtime.ensureDefaultInstance(definition.id)
      await host.refresh()
      const invoke = (method, input = {}) => runtime.requestHostCapability(definition.id, instance.id, MCP_PROTOCOL, method, input, { timeoutMs: 180_000 })
      const pkg = await runtime.getActivePackage(definition.id)
      assert.equal(pkg.manifest.ui.builtin, 'mcp')
      assert.equal(pkg.manifest.backend, undefined)
      assert.equal(pkg.manifest.toolScope, 'session')
      assert.equal(pkg.manifest.navigation.location, 'settings')
      assert.equal(pkg.manifest.category, definition.category)
      assert.deepEqual(host.enabledServers([]), {})
      let server = (await invoke('servers.list')).servers[0]
      const config = structuredClone(server.config)
      let dsn
      if (name === 'excel') config.args[config.args.indexOf('--allow-dir') + 1] = workspace
      if (name === 'database') {
        const file = path.join(workspace, 'data.db')
        database = new DatabaseSync(file)
        database.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)')
        const insert = database.prepare('INSERT INTO orders (id, amount) VALUES (?, ?)')
        for (let i = 1; i <= 1005; i++) insert.run(i, i * 10)
        dsn = `sqlite://${file}`
        const index = config.args.indexOf('--config') + 1
        config.args[index] = path.join(workspace, 'missing.toml')
        await invoke('servers.save', { name, previousName: name, enabled: true, config })
        assert.equal((await invoke('servers.inspect', { name })).servers[0].check.state, 'failed')
        record('Missing connection file reports a failure without connecting to a default database')
        const entries = unzipSync(await fs.readFile(archive))
        const template = Buffer.from(entries['dbhub.example.txt']).toString('utf8')
        assert.match(template, /readonly = true/)
        config.args[index] = path.join(workspace, 'dbhub.toml')
        config.env.MOSS_DATABASE_DSN = dsn
        await fs.writeFile(config.args[index], template)
      }
      await invoke('servers.save', { name, previousName: name, enabled: true, config })
      // Dependency preparation uses the same resolver as Desktop before inspection.
      // On Desktop MOSS_PYTHON_PATH is supplied by the managed runtime.
      await prepareMcpPython(config, { env: { ...process.env, ...config.env } })
      const inspected = (await invoke('servers.inspect', { name })).servers[0]
      assert.equal(inspected.check.state, 'connected', JSON.stringify(inspected.check))
      const selected = host.enabledServers([definition.id], workspace)
      assert.equal(Object.keys(selected).length, 1)
      const runtimeName = Object.keys(selected)[0]
      const serviceId = host.toolCatalog(definition.id)[0].serviceId
      assert.equal(selected[runtimeName].env.MOSS_SESSION_WORKSPACE, workspace)
      assert.equal(host.findServer(runtimeName).config.env.MOSS_SESSION_WORKSPACE, '')
      connection = await open(selected[runtimeName], workspace)
      const tools = (await connection.client.listTools()).tools
      const toolNames = tools.map(tool => tool.name)
      record(`ZIP installation, settings navigation, session selection and ${tools.length} upstream tools`)
      if (name === 'markitdown') {
        assert(toolNames.includes('convert_to_markdown'))
        await execute(connection.command, ['-I', '-c', fixturePython, workspace], { timeout: 30_000 })
        for (const [file, expected] of [['文档 #1.docx', 'Moss document fixture 中文内容'], ['文档 #1.pdf', 'Moss PDF fixture 42'], ['演示 #1.pptx', 'Moss presentation fixture'], ['表格 #1.xlsx', 'Moss spreadsheet fixture']]) {
          const uri = pathToFileURL(path.join(workspace, file)).href
          assert(text(await call(connection.client, 'convert_to_markdown', { uri })).includes(expected), file)
        }
        const missing = await connection.client.callTool({ name: 'convert_to_markdown', arguments: { uri: pathToFileURL(path.join(workspace, 'missing.docx')).href } })
        assert.equal(missing.isError, true)
        record('Local DOCX, PDF, PPTX and XLSX conversion; encoded Chinese/space/# paths; missing file failure')
      } else if (name === 'excel') {
        for (const tool of ['create_workbook', 'write_range', 'read_range', 'create_chart']) assert(toolNames.includes(tool))
        assert(!toolNames.includes('write_vba_module'))
        const file = '预算 #1.xlsx'
        await call(connection.client, 'create_workbook', { path: file, sheets: ['预算'] })
        await call(connection.client, 'write_range', { path: file, sheet: '预算', at: 'A1', rows: [['项目', '金额'], ['设计', 10], ['开发', 20], ['合计', '=SUM(B2:B3)']] })
        assert.match(text(await call(connection.client, 'read_range', { path: file, sheet: '预算', range: 'A1:B4' })), /30/)
        await call(connection.client, 'create_chart', { path: file, sheet: '预算', chart_type: 'bar', options: {}, at: 'D1', source: 'A1:B3' })
        const entries = unzipSync(await fs.readFile(path.join(workspace, file)))
        assert(Object.keys(entries).some(file => /^xl\/charts\/chart\d+\.xml$/.test(file)))
        assert.match(Buffer.from(entries['xl/worksheets/sheet1.xml']).toString(), /SUM\(B2:B3\)/)
        const outside = path.join(temp, 'outside.xlsx')
        const refused = await connection.client.callTool({ name: 'create_workbook', arguments: { path: outside } })
        assert.equal(refused.isError, true)
        await assert.rejects(fs.access(outside))
        await fs.symlink(temp, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
        const escaped = await connection.client.callTool({ name: 'create_workbook', arguments: { path: 'escape/outside.xlsx' } })
        assert.equal(escaped.isError, true)
        record('Workbook create/write/read, SUM calculation, persisted formula/chart, outside-directory and symlink refusal')
      } else {
        assert(toolNames.includes('search_objects') && toolNames.includes('execute_sql'))
        const sql = async statement => call(connection.client, 'execute_sql', { sql: statement })
        assert.match(text(await sql('SELECT COUNT(*) AS total FROM orders')), /1005/)
        const search = await call(connection.client, 'search_objects', { object_type: 'table', pattern: 'orders' })
        assert.match(text(search), /orders/)
        const rows = await sql('SELECT id FROM orders ORDER BY id')
        await fs.writeFile(path.join(output, 'query-result.json'), JSON.stringify(rows, null, 2))
        const parsed = JSON.parse(text(rows))
        assert.equal(parsed.success, true)
        assert.equal(parsed.data.statements[0].rows.length, 1000)
        assert.equal(parsed.data.statements[0].truncated, true)
        for (const statement of ['INSERT INTO orders VALUES (2000, 1)', 'DROP TABLE orders']) {
          const refused = await connection.client.callTool({ name: 'execute_sql', arguments: { sql: statement } })
          assert.equal(refused.isError, true)
        }
        assert.equal(database.prepare('SELECT COUNT(*) AS total FROM orders').get().total, 1005)
        server = (await invoke('servers.list')).servers[0]
        assert.equal(server.config.env.MOSS_DATABASE_DSN, '')
        assert(!JSON.stringify(server).includes(dsn))
        await invoke('servers.save', { name, previousName: name, enabled: true, config: server.config })
        assert.equal(host.enabledServers([definition.id], workspace)[runtimeName].env.MOSS_DATABASE_DSN, dsn)
        record('SQLite schema/query, 1000-row limit, INSERT/DROP refusal, credential masking and blank-value retention')
      }
      await connection.close()
      await runtime.shutdown()
      await start()
      assert.equal(host.toolCatalog(definition.id)[0].serviceId, serviceId)
      const reloaded = host.enabledServers([definition.id], workspace)[runtimeName]
      if (dsn) assert.equal(reloaded.env.MOSS_DATABASE_DSN, dsn)
      connection = await open(reloaded, workspace)
      if (name === 'excel') assert.match(text(await call(connection.client, 'read_range', { path: '预算 #1.xlsx', sheet: '预算', range: 'B4' })), /30/)
      if (name === 'database') assert.match(text(await call(connection.client, 'execute_sql', { sql: 'SELECT COUNT(*) AS total FROM orders' })), /1005/)
      if (name === 'markitdown') assert.match(text(await call(connection.client, 'convert_to_markdown', { uri: pathToFileURL(path.join(workspace, '文档 #1.docx')).href })), /Moss document fixture/)
      await connection.close()
      record('Host restart preserves settings, service identity and saved data; upstream reconnection succeeds')
      await runtime.setAppEnabled(definition.id, false)
      assert.deepEqual(host.enabledServers([definition.id]), {})
      await runtime.setAppEnabled(definition.id, true)
      await host.refresh()
      await runtime.setAppGrants(definition.id, ['mcp:read'])
      assert.deepEqual(host.enabledServers([definition.id]), {})
      await runtime.uninstall(definition.id, { deleteData: true, deleteCredentials: true })
      await host.refresh()
      assert.deepEqual(host.enabledServers([definition.id]), {})
      record('Disablement, revoked permission and uninstall remove tool access')
      await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, archive, tools: toolNames, checks }, null, 2) + '\n')
    } catch (error) {
      await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2) + '\n')
      throw error
    } finally { await connection?.close(); database?.close() }
  }
} finally {
  await Promise.allSettled([...clients].map(client => client.close()))
  await runtime?.shutdown()
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
