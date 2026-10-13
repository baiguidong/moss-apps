import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
const { ensureManagedBrowser, createManagedEndpoint } = require('../src/playwright-cdp/managed.cjs')
const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function temporary() { const root = await mkdtemp(path.join(tmpdir(), 'moss-managed-unit-')); directories.push(root); return root }

test('concurrent managed starts share one browser and persistent profile, and reconnect reuses it', async () => {
  const root = await temporary()
  let ready: any = null, launches = 0
  const options = { root, probe: async () => ready, prepare: async () => '/test/Google Chrome for Testing', spawn: (executable: string, args: string[]) => {
    launches++
    expect(executable).toBe('/test/Google Chrome for Testing')
    expect(args).toContain(`--user-data-dir=${path.join(root, 'browser-profiles/playwright-cdp-19711')}`)
    expect(args).toContain('--no-default-browser-check')
    ready = { webSocketDebuggerUrl: `ws://127.0.0.1:19711/devtools/browser/${launches}` }
    return Object.assign(new EventEmitter(), { pid: process.pid, unref() {} })
  } }
  const args = ['--moss-managed-browser', '--cdp-endpoint', 'http://127.0.0.1:19711']
  const results = await Promise.all([ensureManagedBrowser(args, options), ensureManagedBrowser(args, options)])
  expect(results.map(value => value.mode).sort()).toEqual(['reused', 'started'])
  expect(launches).toBe(1)
  const profile = results[0].profile
  expect((await ensureManagedBrowser(args, options)).mode).toBe('reused')
  ready = null
  expect((await ensureManagedBrowser(args, options)).profile).toBe(profile)
  expect(launches).toBe(2)
  const state = JSON.parse(await readFile(path.join(profile, 'moss-browser.json'), 'utf8'))
  expect(state.kind).toBe('chrome-for-testing')
})

test('never takes over another browser or launches the customer Chrome as a fallback', async () => {
  const options = { root: await temporary(), probe: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/customer' }),
    prepare: async () => { throw new Error('Must not install or launch') } }
  await expect(ensureManagedBrowser(['--moss-managed-browser'], options)).rejects.toThrow('其他浏览器或服务')
  await expect(ensureManagedBrowser(['--moss-managed-browser', '--executable-path', '/Applications/Google Chrome.app'], options)).rejects.toThrow('受管浏览器')
  await expect(ensureManagedBrowser(['--moss-managed-browser', '--user-data-dir', '/Users/customer/Chrome'], options)).rejects.toThrow('固定用户目录')
  await expect(ensureManagedBrowser(['--moss-managed-browser', '--cdp-endpoint', 'https://remote.example'], options)).rejects.toThrow('本机')
})

test('discovery stays idle until automation, then recovers the same profile and refuses a foreign browser', async () => {
  const root = await temporary()
  let ready: any = null, launches = 0, preparations = 0, probes = 0
  const profiles: string[] = []
  const endpoint = await createManagedEndpoint(['--moss-managed-browser'], {
    root, probe: async () => { probes++; return ready }, prepare: async () => { preparations++; return '/test/Chrome for Testing' },
    spawn: (_executable: string, args: string[]) => {
      profiles.push(args.find(arg => arg.startsWith('--user-data-dir='))!)
      ready = { webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/browser/${++launches}` }
      return Object.assign(new EventEmitter(), { pid: process.pid, unref() {} })
    },
  })
  try {
    expect(launches).toBe(0)
    expect(preparations).toBe(0)
    expect(probes).toBe(0)
    expect(await readdir(root)).toEqual([])
    expect((await fetch(endpoint.endpoint + '/')).status).toBe(404)
    expect((await fetch(endpoint.endpoint + '/json/version', { method: 'POST' })).status).toBe(404)
    expect(launches).toBe(0)
    expect(probes).toBe(0)
    const first = await (await fetch(endpoint.endpoint + '/json/version/')).json()
    expect(launches).toBe(1)
    ready = null
    const recovered = await Promise.all([fetch(endpoint.endpoint + '/json/version/'), fetch(endpoint.endpoint + '/json/version')])
    const versions = await Promise.all(recovered.map(response => response.json()))
    expect(versions[0]).toEqual(versions[1])
    expect(versions[0]).not.toEqual(first)
    expect(launches).toBe(2)
    expect(new Set(profiles).size).toBe(1)
    ready = { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/someone-else' }
    const blocked = await fetch(endpoint.endpoint + '/json/version/')
    expect(blocked.status).toBe(503)
    expect(await blocked.text()).toContain('其他浏览器或服务')
    expect(launches).toBe(2)
  } finally { endpoint.close() }
})

test('invalid managed settings fail during discovery setup without touching a browser profile', async () => {
  const root = await temporary()
  await expect(createManagedEndpoint(['--moss-managed-browser', '--cdp-endpoint', 'https://remote.example'], { root })).rejects.toThrow('本机')
  await expect(createManagedEndpoint(['--moss-managed-browser', '--executable-path', '/Applications/Google Chrome.app'], { root })).rejects.toThrow('受管浏览器')
  expect(await readdir(root)).toEqual([])
})
