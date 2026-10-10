import { expect, it } from 'bun:test'
import { fork } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEnvelope } from '@moss/app-sdk'

const nodeExecutable = process.env.MOSS_NODE_PATH || Bun.which(process.platform === 'win32' ? 'node.exe' : 'node')
if (!nodeExecutable) throw new Error('Node is required for the offline Backend test')

it('completes local startup and answers heartbeats while Host and Feishu connections are unavailable, then reconnects in place', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feishu-offline-'))
  const mockSdk = path.join(root, 'lark.mjs')
  await fs.writeFile(mockSdk, `
export const Domain = { Feishu: 'feishu' }
export const AppType = { SelfBuild: 'self-build' }
export const LoggerLevel = { info: 1 }
export class Client {}
export class EventDispatcher { register() {} }
export class WSClient {
  constructor(options) {
    this.options = options
    process.on('message', message => {
      if (message.type === 'fixture.online') { this.options.onReady(); this.finish?.() }
      if (message.type === 'fixture.offline') this.options.onReconnecting()
    })
  }
  start() {
    this.options.onError(new Error('Network is offline'))
    return new Promise(resolve => { this.finish = resolve })
  }
  close() {}
}
`)
  const entry = path.join(root, 'backend.mjs')
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL('../index.ts', import.meta.url))],
    target: 'node', format: 'esm', outdir: root, naming: 'backend.mjs',
    plugins: [{ name: 'offline-feishu', setup(builder) {
      builder.onResolve({ filter: /^@larksuiteoapi\/node-sdk$/ }, () => ({ path: mockSdk }))
    } }],
  })
  expect(build.success).toBe(true)
  const identity = { generation: 1, launchToken: 'offline-test' }
  const child = fork(entry, [], {
    execPath: nodeExecutable, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, MOSS_APP_ID: 'moss.feishu', MOSS_APP_VERSION: '0.4.7', MOSS_APP_INSTANCE_ID: 'default', MOSS_APP_GENERATION: '1', MOSS_APP_LAUNCH_TOKEN: identity.launchToken },
  })
  let stderr = ''
  child.stderr!.on('data', chunk => { stderr += chunk })
  const messages: any[] = []
  child.on('message', message => messages.push(message))
  const exited = new Promise(resolve => child.once('exit', resolve))
  const send = (type: string, payload = {}, id = type) => child.send(createEnvelope(type as any, { ...payload, ...identity }, { id }))
  const waitFor = async (matches: (message: any) => boolean) => {
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
      const message = messages.find(matches)
      if (message) return message
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error(`Backend did not respond: ${stderr}`)
  }
  try {
    const hello = await waitFor(message => message.type === 'service.hello')
    send('service.init', {
      appId: 'moss.feishu', instanceId: 'default', version: '0.4.7',
      config: { appId: 'cli_test' }, secrets: { appSecret: 'test-secret' },
      dataDir: root, runtimeDir: root, protocols: ['moss.agent/v1'],
      permissions: ['agent:bindings:read', 'agent:bindings:write'],
      grants: ['agent:bindings:read', 'agent:bindings:write'],
    }, hello.id)
    await waitFor(message => message.type === 'service.ready')
    // Leave the Host request pending: it must not block local readiness or IPC.
    const binding = await waitFor(message => message.type === 'host.request')
    for (let i = 0; i < 3; i++) {
      send('service.ping', {}, `offline-${i}`)
      await waitFor(message => message.type === 'service.pong' && message.id === `offline-${i}`)
    }
    send('host.response', { protocol: 'moss.agent/v1', requestId: binding.id, ok: true, result: {
      effective: { replyMode: 'ai_auto', agentId: null, session: { mode: 'fixed' }, proactive: { enabled: false } },
    } }, binding.id)
    await waitFor(message => message.type === 'service.status' && message.payload.details?.error === 'Network is offline')
    send('service.ping', {}, 'feishu-offline')
    await waitFor(message => message.type === 'service.pong' && message.id === 'feishu-offline')
    child.send({ type: 'fixture.online' })
    await waitFor(message => message.type === 'service.status' && message.payload.details?.connected === true)
    child.send({ type: 'fixture.offline' })
    await waitFor(message => message.type === 'service.status' && message.payload.details?.error === 'Feishu WebSocket reconnecting')
    send('action.invoke', { name: 'status.get', input: {} }, 'status')
    const status = await waitFor(message => message.type === 'action.result' && message.id === 'status')
    expect(status.payload.result.transportConnected).toBe(false)
    expect(messages.filter(message => message.type === 'service.ready')).toHaveLength(1)
    expect(child.exitCode).toBeNull()
    send('service.shutdown')
    await exited
    expect(child.exitCode).toBe(0)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
    await fs.rm(root, { recursive: true, force: true })
  }
})
