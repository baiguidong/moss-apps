import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, copyFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEnvelope } from '@moss/app-sdk'
import { createTestServer } from '../tests/fixtures.mjs'
const server = await createTestServer()
const appVersion = JSON.parse(readFileSync(new URL('../app.moss.json', import.meta.url), 'utf8')).version
const directory = await mkdtemp(join(tmpdir(), 'moss-http-bundle-'))
const entry = join(directory, 'main.mjs')
await copyFile(fileURLToPath(new URL('../dist/backend/main.mjs', import.meta.url)), entry)
const identity = { generation: 1, launchToken: 'isolated-bundle-verification' }
const child = fork(entry, [], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH, MOSS_APP_ID: 'moss.http-client', MOSS_APP_VERSION: appVersion, MOSS_APP_INSTANCE_ID: 'default', MOSS_APP_GENERATION: '1', MOSS_APP_LAUNCH_TOKEN: identity.launchToken } })
const logs = []
child.stdout.on('data', data => logs.push(data.toString())); child.stderr.on('data', data => logs.push(data.toString()))
function receive(type, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`Timed out waiting for ${type}`)), 10000)
    const message = value => { if (value.type === type && (!id || value.id === id)) done(null, value.payload) }
    const exit = code => done(new Error(`Backend exited with code ${code}: ${logs.join('').slice(0, 3000)}`))
    const done = (error, value) => { clearTimeout(timer); child.off('message', message); child.off('exit', exit); error ? reject(error) : resolve(value) }
    child.on('message', message); child.once('exit', exit)
  })
}
let count = 0
async function invoke(name, input, failure = false) {
  const id = `request-${++count}`, response = receive(failure ? 'action.error' : 'action.result', id)
  child.send(createEnvelope('action.invoke', { name, input, ...identity }, { id }))
  const result = await response
  return failure ? result.error : result.result
}
try {
  await receive('service.hello')
  const ready = receive('service.ready')
  child.send(createEnvelope('service.init', { ...identity, appId: 'moss.http-client', version: appVersion, instanceId: 'default', config: {}, secrets: {}, dataDir: directory, runtimeDir: directory, permissions: [], grants: [], protocols: [] }))
  await ready
  const result = await invoke('request.send', { url: `${server.url}/echo`, method: 'POST', bodyMode: 'json', body: '{"id":9007199254740993}', auth: { type: 'bearer', username: '', password: '', token: 'isolated-test-token' } })
  assert.equal(result.status, 200)
  assert.equal(JSON.parse(result.body).body, '{"id":9007199254740993}')
  assert.equal(JSON.parse(result.body).headers.authorization, 'Bearer isolated-test-token')
  const invalid = await invoke('request.send', { url: 'file:///etc/passwd' }, true)
  assert.match(invalid.message, /http/)
  const large = await invoke('request.send', { url: `${server.url}/gzip` })
  assert.equal(large.bytes, 1048576)
  assert.equal(large.truncated, true)
  const id = `request-${++count}`
  const canceled = receive('action.error', id)
  child.send(createEnvelope('action.invoke', { name: 'request.send', input: { url: `${server.url}/slow` }, ...identity }, { id }))
  await new Promise(resolve => setTimeout(resolve, 120))
  child.send(createEnvelope('action.cancel', { requestId: id, ...identity }))
  assert.match((await canceled).error.message, /已取消/)
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.ok(server.closedSlowRequests() >= 1)
  assert.deepEqual(await readdir(directory), ['main.mjs'])
  assert.equal(logs.join(''), '')
  console.log('Verified standalone Node package: real HTTP/auth/JSON, input errors, bounded gzip response, cancellation closes socket, no files or logs.')
} finally {
  child.kill()
  if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve))
  await server.close()
  await rm(directory, { recursive: true, force: true })
}
