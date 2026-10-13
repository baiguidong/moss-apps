import readline from 'node:readline'
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)
  if (message.id === undefined) continue
  const result = message.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'catalog-fixture', version: '1.0.0' } }
    : message.method === 'tools/list' ? { tools: ['browser_click', 'browser_close'].map(name => ({ name, description: 'Fixture tool', inputSchema: { type: 'object', properties: {} } })) } : {}
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n')
}
