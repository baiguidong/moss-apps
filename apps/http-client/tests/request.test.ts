import { after as afterAll, before as beforeAll, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createHttpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createTestServer } from './fixtures.mjs'
import { prepareRequest, sendRequest } from '../src/core/request'
import { emptyRequest, METHODS, RESPONSE_LIMIT } from '../src/contracts'
import { formatJson } from '../src/core/json'
import { readTemplates, templateRequest } from '../src/lib/templates'
import manifest from '../app.moss.json'
let server: Awaited<ReturnType<typeof createTestServer>>, other: typeof server
beforeAll(async () => { server = await createTestServer(); other = await createTestServer() })
afterAll(async () => { await server.close(); await other.close() })
const pair = (name: string, value: string, enabled = true) => ({ name, value, enabled })
test('the App exposes its UI action without registering an Agent tool', () => {
  assert.deepEqual((manifest.contributes as { tools?: unknown[] }).tools || [], [])
  assert.deepEqual(manifest.backend.actions.map((action: { name: string }) => action.name), ['request.send'])
})
test('methods, duplicate query parameters, Unicode, enabled headers and error status bodies', async () => {
  for (const method of METHODS) {
    const result = await sendRequest({ url: `${server.url}/status?first=1`, method, query: [pair('q', '你好 & +'), pair('q', 'two'), pair('skip', 'no', false)], headers: [pair('X-Example', 'yes'), pair('X-Disabled', 'no', false)] })
    assert.equal(result.status, 418)
    if (method === 'HEAD') { assert.equal(result.body, ''); continue }
    const body = JSON.parse(result.body)
    assert.equal(body.method, method)
    assert.deepEqual(body.query, [['first', '1'], ['q', '你好 & +'], ['q', 'two']])
    assert.equal(body.headers['x-example'], 'yes')
    assert.equal(body.headers['x-disabled'], undefined)
  }
})
test('JSON, raw text, forms, and explicit content types reach the server unchanged', async () => {
  for (const bodyMode of ['json', 'text', 'form'] as const) {
    const result = await sendRequest({ url: `${server.url}/echo`, method: 'POST', bodyMode, body: bodyMode === 'json' ? '{"id":9007199254740993}' : '你好', form: [pair('q', 'a + b'), pair('q', '二')] })
    const response = JSON.parse(result.body)
    assert.equal(response.body, bodyMode === 'form' ? 'q=a+%2B+b&q=%E4%BA%8C' : bodyMode === 'json' ? '{"id":9007199254740993}' : '你好')
    assert.ok((response.headers['content-type']).includes(({ json: 'application/json', text: 'text/plain', form: 'application/x-www-form-urlencoded' })[bodyMode]))
  }
  const response = await sendRequest({ url: `${server.url}/echo`, method: 'PUT', bodyMode: 'text', body: 'x', headers: [pair('content-type', 'application/custom')] })
  assert.equal(JSON.parse(response.body).headers['content-type'], 'application/custom')
})
test('Basic and Bearer auth and credential conflict validation', async () => {
  const auth = { ...emptyRequest().auth, type: 'basic' as const, username: 'moss', password: '你好' }
  const basic = await sendRequest({ url: `${server.url}/echo`, auth })
  assert.equal(JSON.parse(basic.body).headers.authorization, `Basic ${Buffer.from('moss:你好').toString('base64')}`)
  const bearer = await sendRequest({ url: `${server.url}/echo`, auth: { ...auth, type: 'bearer', token: 'test.token' } })
  assert.equal(JSON.parse(bearer.body).headers.authorization, 'Bearer test.token')
  assert.throws(() => prepareRequest({ url: server.url, auth, headers: [pair('Authorization', 'other')] }), (error: unknown) => error instanceof Error && error.message.includes('只能填写一处'))
})
test('redirects follow method/body semantics and can be disabled', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const result = await sendRequest({ url: `${server.url}/redirect?status=${status}`, method: 'POST', bodyMode: 'text', body: 'data' })
    assert.equal((result.redirects).length, 1)
    assert.equal(JSON.parse(result.body).method, status >= 307 ? 'POST' : 'GET')
    assert.equal(JSON.parse(result.body).body, status >= 307 ? 'data' : '')
  }
  const raw = await sendRequest({ url: `${server.url}/redirect`, followRedirects: false })
  assert.equal(raw.status, 302); assert.equal((raw.redirects).length, 0)
  await assert.rejects(sendRequest({ url: `${server.url}/loop` }), (error: unknown) => error instanceof Error && error.message.includes('超过 10 次'))
})
test('cross-origin redirects remove all custom credentials and never forward a body', async () => {
  const url = `${server.url}/redirect?to=${encodeURIComponent(`${other.url}/echo`)}`
  const result = await sendRequest({ url, headers: [pair('Authorization', 'secret'), pair('Cookie', 'secret'), pair('X-Api-Key', 'secret')] })
  const headers = JSON.parse(result.body).headers
  assert.equal(headers.authorization, undefined); assert.equal(headers.cookie, undefined); assert.equal(headers['x-api-key'], undefined)
  const before = other.requests.length
  const stopped = await sendRequest({ url: `${url}&status=307`, method: 'POST', bodyMode: 'text', body: 'private' })
  assert.equal(stopped.status, 307); assert.ok((stopped.notice).includes('携带正文')); assert.equal(other.requests.length, before)
})
test('timeouts and cancellation close the network operation', async () => {
  await assert.rejects(sendRequest({ url: `${server.url}/slow`, timeoutMs: 1000 }), (error: unknown) => error instanceof Error && error.message.includes('超过 1 秒'))
  const controller = new AbortController()
  const pending = sendRequest({ url: `${server.url}/slow` }, controller.signal)
  await new Promise(resolve => setTimeout(resolve, 60)); controller.abort()
  await assert.rejects(pending, (error: unknown) => error instanceof Error && error.message.includes('已取消'))
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.ok((server.closedSlowRequests()) >= 2)
  await assert.rejects(sendRequest({ url: `${server.url}/echo` }, controller.signal), (error: unknown) => error instanceof Error && error.message.includes('已取消'))
})
test('response limits apply after decompression and do not split UTF-8 into replacement characters', async () => {
  for (const route of ['/large', '/gzip']) {
    const result = await sendRequest({ url: server.url + route })
    assert.equal(result.bytes, RESPONSE_LIMIT); assert.equal(result.truncated, true)
    assert.equal(result.bodyEncoding, 'text'); assert.ok(!(result.body).includes('�'))
  }
})
test('binary, invalid UTF-8, alternate charset, empty responses and separate cookies', async () => {
  const binary = await sendRequest({ url: `${server.url}/binary` })
  assert.equal(binary.bodyEncoding, 'base64'); assert.equal(binary.body, 'AP+AKg==')
  assert.equal((await sendRequest({ url: `${server.url}/invalid-utf8` })).bodyEncoding, 'base64')
  assert.equal((await sendRequest({ url: `${server.url}/latin` })).body, 'café')
  assert.equal((await sendRequest({ url: `${server.url}/empty` })).body, '')
  const cookies = await sendRequest({ url: `${server.url}/cookies` })
  assert.equal((cookies.headers.filter(header => header.name === 'set-cookie')).length, 2)
  assert.equal(JSON.parse((await sendRequest({ url: `${server.url}/echo` })).body).headers.cookie, undefined)
})
test('malformed and oversized input is rejected before any network activity', () => {
  const baseline = server.requests.length
  for (const input of [null, { url: 'file:///etc/passwd' }, { url: 'http://name:secret@example.com' }, { url: server.url, method: 'CONNECT' }, { url: server.url, timeoutMs: 1 }, { url: server.url, bodyMode: 'json', body: '{}' }, { url: server.url, method: 'POST', bodyMode: 'json', body: '{"x":}' }, { url: server.url, headers: [pair('X-Test', 'a\r\nb')] }, { url: server.url, headers: [pair('Host', 'elsewhere')] }, { url: server.url, headers: [pair('content-length', '999')] }, { url: server.url, body: 'a'.repeat(RESPONSE_LIMIT + 1) }, { url: server.url, query: [pair('x', 'a'.repeat(20000))] }]) assert.throws(() => prepareRequest(input))
  assert.equal(server.requests.length, baseline)
})
test('JSON formatting preserves big integers and detects invalid/deep input', () => {
  assert.ok((formatJson('{"id":9007199254740993,"float":1e1000}')).includes('9007199254740993'))
  assert.ok((formatJson('{"float":1e1000}')).includes('1e1000'))
  assert.throws(() => formatJson('{\n"x":\n}'), (error: unknown) => error instanceof Error && error.message.includes('第 3 行'))
  assert.throws(() => formatJson('['.repeat(129) + '0' + ']'.repeat(129)), (error: unknown) => error instanceof Error && error.message.includes('128'))
})
test('templates remove all value fields and survive schema changes or malformed storage', () => {
  const request = { ...emptyRequest(), url: 'https://u:password@example.com/echo?token=secret&q=2#private', query: [pair('api_key', 'secret')], headers: [pair('X-Private', 'secret')], form: [pair('password', 'secret')], body: 'private', auth: { type: 'bearer' as const, token: 'secret', username: 'name', password: 'password' } }
  const saved = templateRequest(request)
  assert.equal(saved.url, 'https://example.com/echo')
  assert.deepEqual(saved.query.map(row => row.name), ['token', 'q', 'api_key'])
  assert.equal(saved.query.every(row => row.value === ''), true)
  assert.equal(saved.body, ''); assert.equal(saved.headers[0]!.value, ''); assert.equal(saved.form[0]!.value, '')
  assert.deepEqual(saved.auth, emptyRequest().auth)
  const templates = [{ id: 'one', name: 'Example', request }]
  assert.deepEqual(readTemplates(templates)[0]!.request, saved)
  assert.equal((readTemplates([null, { id: 'bad' }, ...templates, ...templates])).length, 1)
  assert.deepEqual(readTemplates({}), [])
})
test('real HTTPS validates certificates and refuses redirects to plaintext HTTP', async () => {
  const directory = process.env.MOSS_HTTP_TEST_CERTS!
  for (const name of ['trusted', 'untrusted']) {
    const secure = createHttpsServer({ key: readFileSync(join(directory, `${name}.key`)), cert: readFileSync(join(directory, `${name}.crt`)) }, (req, res) => {
      if (req.url === '/redirect') res.writeHead(302, { location: `${server.url}/echo` })
      res.end('secure-response')
    })
    await new Promise<void>(resolve => secure.listen(0, '127.0.0.1', resolve))
    const url = `https://127.0.0.1:${(secure.address() as AddressInfo).port}`
    try {
      if (name === 'untrusted') await assert.rejects(sendRequest({ url }), (error: unknown) => error instanceof Error && error.message.includes('证书验证失败'))
      else {
        assert.equal((await sendRequest({ url })).body, 'secure-response')
        const before = server.requests.length
        const result = await sendRequest({ url: `${url}/redirect` })
        assert.equal(result.status, 302); assert.ok(result.notice.includes('HTTPS 到 HTTP'))
        assert.equal(server.requests.length, before)
      }
    } finally { secure.closeAllConnections(); await new Promise<void>(resolve => secure.close(() => resolve())) }
  }
})
