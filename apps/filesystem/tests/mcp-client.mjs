import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
const nodeExecutable = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
let builtServer
async function serverEntry(entry) {
  // Production MCP servers run under Node. Compile the same external-package
  // entry rather than exercising Bun's Windows subprocess/stdio implementation.
  builtServer ||= Bun.build({ entrypoints: [entry], target: 'node', format: 'esm',
    packages: 'external', outdir: fileURLToPath(new URL('../dist/test-server/', import.meta.url)), naming: 'cli.mjs' })
  const result = await builtServer
  if (!result.success) throw new AggregateError(result.logs, 'MCP test server build failed')
  return result.outputs[0].path
}
export async function connect(entry, args = [], options = {}) {
  const transport = new StdioClientTransport({ command: nodeExecutable, args: [await serverEntry(entry), ...args],
    env: { ...process.env, PATH: '', MOSS_SESSION_WORKSPACE: '', npm_config_offline: 'true', ...options.env }, stderr: 'pipe', cwd: options.cwd })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr += chunk })
  const client = new Client({ name: 'app-verification', version: '1.0.0' }, { capabilities: options.roots ? { roots: { listChanged: true } } : {} })
  if (options.roots) client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: options.roots }))
  try { await client.connect(transport, { timeout: 15000 }) }
  catch (error) { await transport.close(); throw new Error(`${error.message}\n${stderr}`) }
  const callTool = client.callTool.bind(client)
  client.callTool = async (request, schema, options) => {
    try { return await callTool(request, schema, { timeout: 15000, ...options }) }
    catch (error) { throw new Error(`${request.name}: ${error.message}\n${stderr}`, { cause: error }) }
  }
  return { client, transport, stderr: () => stderr, close: () => client.close() }
}
export async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(JSON.stringify(result))
  return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
}
