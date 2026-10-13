import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const upstream = createRequire(require.resolve('@modelcontextprotocol/server-memory/dist/index.js'))
const { Client } = await import(pathToFileURL(upstream.resolve('@modelcontextprotocol/sdk/client/index.js')).href)
const { StdioClientTransport } = await import(pathToFileURL(upstream.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href)
export async function connect(entry, args = [], options = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, ...args],
    env: { ...process.env, PATH: '', npm_config_offline: 'true', ...options.env }, stderr: 'pipe', cwd: options.cwd })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr += chunk })
  const client = new Client({ name: 'memory-verification', version: '1.0.0' })
  try { await client.connect(transport) }
  catch (error) { await transport.close(); throw new Error(`${error.message}\n${stderr}`) }
  return { client, transport, stderr: () => stderr, close: () => client.close() }
}
export async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(JSON.stringify(result))
  const text = result.content.find(item => item.type === 'text').text
  try { return JSON.parse(text) } catch { return result.structuredContent || text }
}
