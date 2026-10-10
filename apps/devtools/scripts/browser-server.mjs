import { readFileSync } from 'node:fs'
// Test-only bridge to the compiled Node Backend; no request implementation is mocked.
import { fork } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEnvelope } from '@moss/app-sdk'
import { createTestServer } from '../tests/http/fixtures.mjs'
const appVersion = JSON.parse(readFileSync(new URL('../app.moss.json', import.meta.url), 'utf8')).version
const directory = await mkdtemp(join(tmpdir(), 'moss-http-browser-'))
const fixture = await createTestServer(), pending = new Map()
const identity = { generation: 1, launchToken: 'browser-integration' }
const backend = fork(fileURLToPath(new URL('../dist/backend/main.mjs', import.meta.url)), [], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH, MOSS_APP_ID: 'moss.devtools', MOSS_APP_VERSION: appVersion, MOSS_APP_INSTANCE_ID: 'default', MOSS_APP_GENERATION: '1', MOSS_APP_LAUNCH_TOKEN: identity.launchToken } })
backend.stdout.pipe(process.stdout); backend.stderr.pipe(process.stderr)
await new Promise((resolve, reject) => {
  backend.once('error', reject)
  backend.once('exit', code => reject(new Error(`Backend exit ${code}`)))
  backend.on('message', message => {
    if (message.type === 'service.hello') backend.send(createEnvelope('service.init', { ...identity, appId: 'moss.devtools', version: appVersion, instanceId: 'default', config: {}, secrets: {}, dataDir: directory, runtimeDir: directory, permissions: [], grants: [], protocols: [] }))
    if (message.type === 'service.ready') resolve()
    if (message.type === 'action.result' || message.type === 'action.error') {
      const callback = pending.get(message.id)
      if (callback) { pending.delete(message.id); callback(message.type === 'action.error' ? { error: message.payload.error.message } : { result: message.payload.result }) }
    }
  })
})
const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  if (origin && origin !== 'http://127.0.0.1:4178') { res.writeHead(403); res.end(); return }
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4178')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  const finish = data => { if (!res.destroyed) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)) } }
  if (req.url === '/info') { finish({ target: fixture.url }); return }
  if (req.url === '/inspect') { finish({ requests: fixture.requests, closedSlowRequests: fixture.closedSlowRequests() }); return }
  if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(400); res.end(); return }
  try {
    let body = ''
    for await (const chunk of req) { body += chunk; if (body.length > 3 * 1024 * 1024) throw new Error('too large') }
    const value = JSON.parse(body)
    if (req.url === '/cancel') { backend.send(createEnvelope('action.cancel', { requestId: value.id, ...identity })); finish({ canceled: true }); return }
    if (req.url !== '/invoke') throw new Error('invalid route')
    pending.set(value.id, finish)
    backend.send(createEnvelope('action.invoke', { name: value.name, input: value.input, ...identity }, { id: value.id }))
  } catch { res.writeHead(400); res.end() }
})
await new Promise(resolve => server.listen(4181, '127.0.0.1', resolve))
let closing = false
const close = async () => {
  if (closing) return; closing = true
  server.closeAllConnections(); server.close(); await fixture.close(); backend.kill()
  await rm(directory, { recursive: true, force: true }); process.exit()
}
process.on('SIGINT', close); process.on('SIGTERM', close)
