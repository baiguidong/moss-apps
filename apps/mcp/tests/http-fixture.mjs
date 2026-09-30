import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
export async function startMcpFixture() {
  const streams = new Map(), seen = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/sse' && req.method === 'GET') {
      const id = randomUUID(); res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      streams.set(id, res); res.write(`event: endpoint\ndata: /messages?sessionId=${id}\n\n`)
      req.on('close', () => streams.delete(id)); return
    }
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    if (!['/mcp', '/messages'].includes(url.pathname)) { res.writeHead(503, { 'content-type': 'text/plain' }).end('Fixture unavailable'); return }
    if (url.pathname === '/mcp' && req.headers.authorization !== 'Bearer http-test-secret') { res.writeHead(401).end(); return }
    let body = ''; for await (const chunk of req) body += chunk
    let message
    try { message = JSON.parse(body) } catch { res.writeHead(400).end(); return }
    seen.push(message.method)
    if (message.id === undefined) { res.writeHead(202).end(); return }
    const result = message.method === 'initialize'
      ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'Remote fixture', version: '1.0.0' } }
      : message.method === 'tools/list'
        ? { tools: [{ name: message.params?.cursor ? 'lookup' : 'search', description: 'Find fixture information', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }], ...(!message.params?.cursor ? { nextCursor: 'page-2' } : {}) }
        : message.method === 'tools/call' ? { content: [{ type: 'text', text: 'fixture result' }] } : {}
    const reply = { jsonrpc: '2.0', id: message.id, result }
    if (url.pathname === '/messages') { streams.get(url.searchParams.get('sessionId'))?.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`); res.writeHead(202).end() }
    else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, seen,
    async close() { for (const res of streams.values()) res.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}
