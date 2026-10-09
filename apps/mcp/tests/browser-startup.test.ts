import { afterEach, expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const { ensureBrowser, localEndpoint, chromeCandidates, probeEndpoint } = require('../src/playwright-cdp/browser.cjs')
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function temporary() {
  const home = await mkdtemp(path.join(tmpdir(), 'moss-browser-unit-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  return home
}
async function endpoint(body = '') {
  const server = createServer((_req, res) => { res.end(body) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

test('auto-start is limited to ordinary loopback CDP endpoints', () => {
  expect(localEndpoint('http://localhost:9444')).toEqual({ url: 'http://127.0.0.1:9444', port: 9444 })
  for (const address of ['https://localhost:9222', 'http://0.0.0.0:9222', 'http://192.168.1.2:9222', 'ws://127.0.0.1:9222/devtools/browser/id', 'http://user:pass@127.0.0.1:9222', 'http://127.0.0.1:9222/proxy', 'invalid']) expect(localEndpoint(address)).toBeNull()
})

test('macOS user installs, Windows install locations and Linux binaries are discoverable', () => {
  expect(chromeCandidates('darwin', {}, '/Users/test')).toContain('/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  expect(chromeCandidates('win32', { LOCALAPPDATA: 'D:\\Users\\Test User\\AppData\\Local', PROGRAMFILES: 'D:\\Program Files' }, 'D:\\Users\\Test User')).toContain('D:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  expect(chromeCandidates('linux', { PATH: '/custom/bin' }, '/home/test')).toContain('/custom/bin/google-chrome')
})

test('ready CDP is reused without requiring a local Chrome installation', async () => {
  const address = await endpoint(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/fixture' }))
  expect(await probeEndpoint(address)).toBe('ready')
  expect(await ensureBrowser(['--cdp-endpoint', address, '--executable-path', '/missing/chrome'])).toEqual({ mode: 'reused' })
})

test('unrelated occupied ports produce a useful error and never launch a browser', async () => {
  const address = await endpoint('unrelated web server')
  expect(await probeEndpoint(address)).toBe('occupied')
  await expect(ensureBrowser(['--cdp-endpoint', address], { home: await temporary() })).rejects.toThrow('端口')
})

test('concurrent MCP starts launch once, share a persistent profile, and reuse the ready endpoint', async () => {
  const home = await temporary()
  let ready = false, launches = 0
  const options = { home, timeoutMs: 2000, probe: async () => ready ? 'ready' : 'closed', launch: async (config: any) => {
    launches++
    expect(config.profile).toBe(path.join(home, '.moss/browser-profiles/playwright-cdp-19711'))
    expect(config.executable).toBe(process.execPath)
    await new Promise(resolve => setTimeout(resolve, 40))
    ready = true
    return { pid: 1 }
  } }
  const args = ['--cdp-endpoint=http://127.0.0.1:19711', '--executable-path', process.execPath]
  const results = await Promise.all([ensureBrowser(args, options), ensureBrowser(args, options), ensureBrowser(args, options)])
  expect(launches).toBe(1)
  expect(results.map(item => item.mode).sort()).toEqual(['reused', 'reused', 'started'])
  ready = false
  expect((await ensureBrowser(args, options)).mode).toBe('started')
  expect(launches).toBe(2)
})

test('help and remote endpoints do not launch Chrome, and missing Chrome is actionable', async () => {
  const probe = () => { throw new Error('should not probe') }
  expect(await ensureBrowser(['--help', '--cdp-endpoint', 'http://127.0.0.1:9222'], { probe })).toEqual({ mode: 'connect-only' })
  expect(await ensureBrowser(['--cdp-endpoint', 'https://remote.example/cdp'], { probe })).toEqual({ mode: 'connect-only' })
  await expect(ensureBrowser(['--cdp-endpoint', 'http://127.0.0.1:19712', '--executable-path', '/missing/chrome'], { home: await temporary(), probe: async () => 'closed' })).rejects.toThrow('Chrome 可执行文件不可用')
})

test('startup failure is returned in the MCP initialize response for the Host UI', async () => {
  const address = await endpoint('not CDP')
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../src/playwright-cdp/cli.cjs'), '--cdp-endpoint', address], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const done = new Promise<number | null>((resolve, reject) => { child.on('exit', resolve); child.on('error', reject) })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n')
  expect(await done).toBe(1)
  expect(JSON.parse(stdout)).toMatchObject({ id: 7, error: { code: -32000, message: expect.stringContaining('端口') } })
  expect(stderr).toContain('[playwright-cdp]')
})
