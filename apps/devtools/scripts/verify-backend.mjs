import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, copyFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEnvelope } from '@moss/app-sdk'
const appVersion = JSON.parse(readFileSync(new URL('../app.moss.json', import.meta.url), 'utf8')).version
const directory = await mkdtemp(join(tmpdir(), 'moss-devtools-bundle-'))
const entry = join(directory, 'main.mjs')
await copyFile(fileURLToPath(new URL('../dist/backend/main.mjs', import.meta.url)), entry)
const identity = { generation: 1, launchToken: 'isolated-bundle-verification' }
const child = fork(entry, [], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH, MOSS_APP_ID: 'moss.devtools', MOSS_APP_VERSION: appVersion, MOSS_APP_INSTANCE_ID: 'default', MOSS_APP_GENERATION: '1', MOSS_APP_LAUNCH_TOKEN: identity.launchToken } })
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
  child.send(createEnvelope('service.init', { ...identity, appId: 'moss.devtools', version: appVersion, instanceId: 'default', config: {}, secrets: {}, dataDir: directory, runtimeDir: directory, permissions: [], grants: [], protocols: [] }))
  await ready
  assert.equal((await invoke('timestamp.convert', { direction: 'timestamp', input: '1704067200123', unit: 'auto', timezone: 'UTC' })).utc, '2024-01-01T00:00:00.123Z')
  assert.equal((await invoke('base64.convert', { operation: 'encode', input: '你好 👋', urlSafe: false })).text, Buffer.from('你好 👋').toString('base64'))
  assert.match((await invoke('json.process', { operation: 'format', input: '{"id":9007199254740993}', indent: '2' })).text, /9007199254740993/)
  const params = { operation: 'encrypt', mode: 'GCM', input: '', key: '00'.repeat(16), keyEncoding: 'hex', iv: '00'.repeat(12), ivEncoding: 'hex', outputEncoding: 'hex' }
  const encrypted = await invoke('aes.process', params)
  assert.equal(encrypted.text, '58e2fccefa7e3061367f1d57a4e7455a')
  assert.equal((await invoke('aes.process', { ...params, operation: 'decrypt', input: encrypted.text })).text, '')
  assert.match((await invoke('aes.process', { ...params, key: 'bad-key' }, true)).message, /Hex/)
  assert.ok((await invoke('not-an-action', {}, true)).code)
  assert.deepEqual(await readdir(directory), ['main.mjs'])
  assert.equal(logs.join(''), '')
  console.log('Verified standalone Node bundle: four actions, NIST vector, errors, no data writes or logs.')
} finally {
  child.kill()
  if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve))
  await rm(directory, { recursive: true, force: true })
}
