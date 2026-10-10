import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'

export async function createTestServer() {
  const requests = []
  let closedSlowRequests = 0
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString('utf8')
      requests.push({ method: req.method, url: req.url, headers: req.headers, body })
      if (url.pathname === '/slow') {
        const timer = setTimeout(() => res.end('late'), 10000)
        res.on('close', () => { clearTimeout(timer); closedSlowRequests++ })
        return
      }
      if (url.pathname === '/redirect') {
        res.writeHead(Number(url.searchParams.get('status') || 302), { location: url.searchParams.get('to') || '/echo' }); res.end('redirect'); return
      }
      if (url.pathname === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); return }
      if (url.pathname === '/binary') { res.setHeader('content-type', 'application/octet-stream'); res.end(Buffer.from([0, 255, 128, 42])); return }
      if (url.pathname === '/latin') { res.setHeader('content-type', 'text/plain; charset=iso-8859-1'); res.end(Buffer.from([99, 97, 102, 233])); return }
      if (url.pathname === '/invalid-utf8') { res.setHeader('content-type', 'text/plain'); res.end(Buffer.from([255, 128])); return }
      if (url.pathname === '/large' || url.pathname === '/gzip') {
        const data = Buffer.from('你好'.repeat(400000))
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        if (url.pathname === '/gzip') { res.setHeader('content-encoding', 'gzip'); res.end(gzipSync(data)) } else res.end(data)
        return
      }
      if (url.pathname === '/cookies') { res.setHeader('set-cookie', ['one=1; HttpOnly', 'two=2; Path=/']); res.end('cookies'); return }
      if (url.pathname === '/html') { res.setHeader('content-type', 'text/html'); res.end('<script>window.untrustedExecuted=true</script><h1>Not rendered</h1>'); return }
      if (url.pathname === '/empty') { res.writeHead(204); res.end(); return }
      if (url.pathname === '/bigint') { res.setHeader('content-type', 'application/json'); res.end('{"id":9007199254740993,"name":"Moss"}'); return }
      if (url.pathname === '/status') res.statusCode = 418
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('x-test-response', 'received')
      res.end(JSON.stringify({ method: req.method, query: [...url.searchParams], headers: req.headers, body }))
    } catch { if (!res.destroyed) { res.statusCode = 500; res.end('fixture error') } }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`, requests,
    closedSlowRequests: () => closedSlowRequests,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) },
  }
}
