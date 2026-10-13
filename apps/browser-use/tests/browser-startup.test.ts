import { afterEach, expect, test } from 'bun:test'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
const { connectionArgs, validateExtensionProfile } = require('../src/playwright-cdp/browser.cjs')
const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })

test('an unconfigured launcher always attaches through the extension, including environment overrides', () => {
  expect(connectionArgs([], {})).toEqual(['--extension'])
  expect(connectionArgs(['--output-dir', '~/Output'], { PLAYWRIGHT_MCP_EXTENSION: 'false' })).toEqual(['--extension', '--output-dir', '~/Output'])
  expect(connectionArgs(['--extension', '--profile-dir-name', 'Profile 1'], {})).toEqual(['--extension', '--profile-dir-name', 'Profile 1'])
})

test('explicit CDP and bound endpoints stay connect-only with no browser auto-start', () => {
  for (const address of ['http://localhost:9222', 'http://127.0.0.1:9444', 'https://remote.example/cdp', 'ws://127.0.0.1/devtools/browser/a']) {
    const args = ['--cdp-endpoint', address]
    expect(connectionArgs(args, {})).toEqual(args)
    expect(connectionArgs([`--cdp-endpoint=${address}`], {})).toEqual([`--cdp-endpoint=${address}`])
  }
  expect(connectionArgs([], { PLAYWRIGHT_MCP_CDP_ENDPOINT: 'http://localhost:9222' })).toEqual([])
  expect(connectionArgs(['--endpoint', 'ws://localhost/bound'], {})).toEqual(['--endpoint', 'ws://localhost/bound'])
})

test('isolated profiles and launch configuration files cannot override extension attachment', () => {
  expect(() => connectionArgs(['--extension', '--isolated'], {})).toThrow('--isolated')
  expect(() => connectionArgs([], { PLAYWRIGHT_MCP_ISOLATED: 'true' })).toThrow('--isolated')
  expect(() => connectionArgs([], { PLAYWRIGHT_MCP_ISOLATED: '1' })).toThrow('--isolated')
  expect(() => connectionArgs(['--config=launch.json'], {})).toThrow('--config')
  expect(() => connectionArgs([], { PLAYWRIGHT_MCP_CONFIG: 'launch.json' })).toThrow('--config')
  expect(connectionArgs(['--help'], {})).toEqual(['--help'])
})

test('custom executables cannot create a new Chrome profile through flags or environment', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moss-extension-guard-')); directories.push(directory)
  const missing = path.join(directory, 'missing')
  await expect(validateExtensionProfile(['--extension', '--executable-path', '/custom/chrome'], {})).rejects.toThrow('现有 Chrome 用户目录')
  await expect(validateExtensionProfile(['--extension', '--executable-path=/custom/chrome', '--user-data-dir', missing], {})).rejects.toThrow('不会创建')
  await expect(validateExtensionProfile(['--extension'], { PLAYWRIGHT_MCP_EXECUTABLE_PATH: '/custom/chrome', PLAYWRIGHT_MCP_USER_DATA_DIR: missing })).rejects.toThrow('不会创建')
  await expect(readFile(path.join(missing, 'Local State'))).rejects.toHaveProperty('code', 'ENOENT')
})

test('custom connections pin an existing installed profile and respect last-used or explicit selection', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moss-extension-guard-')); directories.push(directory)
  const extensionId = 'mmlmfjhmonkocbjadbfplnigmagldckm'
  for (const name of ['Default', 'Profile 1', 'Profile 2']) {
    await mkdir(path.join(directory, name), { recursive: true })
    await writeFile(path.join(directory, name, 'Preferences'), JSON.stringify(name === 'Profile 2' ? {} : { extensions: { settings: { [extensionId]: { state: 1 } } } }))
  }
  await writeFile(path.join(directory, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 1' } }))
  const args = ['--extension', '--executable-path', '/custom/chrome', '--user-data-dir', directory]
  expect((await validateExtensionProfile(args, {})).slice(-2)).toEqual(['--profile-dir-name', 'Profile 1'])
  expect((await validateExtensionProfile([...args, '--profile-dir-name=Default'], {})).slice(-2)).toEqual(['--profile-dir-name', 'Default'])
  await expect(validateExtensionProfile([...args, '--profile-dir-name', 'Profile 2'], {})).rejects.toThrow('已安装 Playwright 扩展')
  await expect(validateExtensionProfile([...args, '--profile-dir-name', '../outside'], {})).rejects.toThrow('现有目录名')
})

test('unsupported browser launch options fail through MCP initialize without launching Chrome', async () => {
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../src/playwright-cdp/cli.cjs'), '--isolated'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const done = new Promise<number | null>((resolve, reject) => { child.on('exit', resolve); child.on('error', reject) })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n')
  expect(await done).toBe(1)
  expect(JSON.parse(stdout)).toMatchObject({ id: 7, error: { code: -32000, message: expect.stringContaining('--isolated') } })
  expect(stderr).toContain('[playwright-cdp]')
})
