import { createInterface } from 'node:readline'
const input = createInterface({ input: process.stdin })
input.on('line', line => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const result = message.method === 'initialize'
    ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'Local fixture', version: '1.0.0' } }
    : message.method === 'tools/list'
      ? { tools: [{ name: process.env.FIXTURE_KEY === 'local-test-secret' ? 'read_workspace' : 'missing_credentials', description: 'Read a test workspace file', inputSchema: { type: 'object', properties: {} } }] }
      : message.method === 'tools/call' ? { content: [{ type: 'text', text: 'fixture result' }] } : {}
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
})
