import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
export async function connect(entry, args = [], options = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, ...args],
    env: { ...process.env, PATH: '', MOSS_SESSION_WORKSPACE: '', npm_config_offline: 'true', ...options.env }, stderr: 'pipe', cwd: options.cwd })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr += chunk })
  const client = new Client({ name: 'app-verification', version: '1.0.0' }, { capabilities: options.roots ? { roots: { listChanged: true } } : {} })
  if (options.roots) client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: options.roots }))
  try { await client.connect(transport) }
  catch (error) { await transport.close(); throw new Error(`${error.message}\n${stderr}`) }
  return { client, transport, stderr: () => stderr, close: () => client.close() }
}
export async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(JSON.stringify(result))
  return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
}
