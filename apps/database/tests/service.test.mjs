import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Database } from 'bun:sqlite'
import { DatabaseService, defaults, connectionError } from '../src/backend/service.mjs'

async function fixture(run) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-db-test-'))
  const servers = new Map(), credentials = new Map()
  let failure = false
  const context = { dataDir, signal: new AbortController().signal }
  const request = async (method, input) => {
    const old = servers.get(input.name)
    if (method === 'servers.save') {
      if (failure) throw new Error('save failed')
      const env = Object.fromEntries(Object.entries(input.config.env).map(([key, value]) => [key, value || credentials.get(input.name)?.[key] || '']))
      credentials.set(input.name, env)
      servers.set(input.name, { name: input.name, enabled: input.enabled, config: { ...input.config, env: Object.fromEntries(Object.keys(env).map(key => [key, ''])) } })
    } else if (method === 'servers.remove') { servers.delete(input.name); credentials.delete(input.name) }
    else if (method === 'servers.set-enabled') old.enabled = input.enabled
    else if (method === 'servers.inspect') old.check = { state: 'connected', tools: [{ name: 'execute_sql' }] }
    return { servers: [...servers.values()] }
  }
  const service = new DatabaseService(request)
  const call = (method, input = {}) => service.run(method, input, context)
  try { await run({ dataDir, servers, credentials, call, context, request, fail: () => { failure = true } }) }
  finally { await fs.rm(dataDir, { recursive: true, force: true }) }
}
const postgres = { ...defaults, title: '订单数据库', database: 'orders', username: 'reader' }

test('connection failures distinguish driver startup, login and database errors without exposing credentials', () => {
  const secret = 'mysql://root:secret@example.test/orders'
  for (const [error, expected] of [
    ['Cannot find module sql-escaper', '驱动未能加载'],
    ['MCP error -32000: Connection closed', '启动时退出'],
    ['ER_BAD_DB_ERROR: Unknown database', '数据库不存在'],
    ['Access denied', '拒绝登录'],
    ['ECONNREFUSED', '端口拒绝连接'],
    ['ENOTFOUND', '无法解析'],
    ['ETIMEDOUT', '连接超时'],
    ['unexpected failure', '连接未成功'],
  ]) {
    expect(connectionError(`${error}: ${secret}`)).toContain(expected)
    expect(connectionError(`${error}: ${secret}`)).not.toContain(secret)
  }
})

test('fresh install has no broken placeholder; multiple dynamic connections survive backend restart', () => fixture(async f => {
  expect((await f.call('list')).connections).toEqual([])
  const first = await f.call('save', { ...postgres, password: 'secret' })
  await f.call('save', { ...postgres, title: '报表库', kind: 'mysql', port: 3306 })
  const restarted = new DatabaseService(f.request)
  const list = await restarted.run('list', {}, f.context)
  expect(list.connections.map(c => c.title)).toEqual(['订单数据库', '报表库'])
  expect(first.connections[0].readonly).toBe(true)
  expect(JSON.stringify(list)).not.toContain('secret')
  expect(list.connections[0]).not.toHaveProperty('password')
  expect(list.connections[0]).not.toHaveProperty('config')
}))

test('password edits preserve, replace and clear credentials without writing them to TOML', () => fixture(async f => {
  const password = 'a:@/ ?#中文${HOME}'
  const { savedId: id } = await f.call('save', { ...postgres, password })
  const file = f.servers.get(id).config.args.at(-1)
  const toml = await fs.readFile(file, 'utf8')
  expect(toml).not.toContain(password)
  expect(toml).not.toContain(encodeURIComponent(password))
  expect(toml).toContain('${MOSS_DATABASE_PASSWORD}')
  expect(f.credentials.get(id).MOSS_DATABASE_PASSWORD).toBe(encodeURIComponent(password))
  await f.call('save', { ...postgres, id, host: 'example.test', password: '' })
  expect(f.credentials.get(id).MOSS_DATABASE_PASSWORD).toBe(encodeURIComponent(password))
  await f.call('save', { ...postgres, id, password: 'new-password' })
  expect(f.credentials.get(id).MOSS_DATABASE_PASSWORD).toBe('new-password')
  await f.call('save', { ...postgres, id, clearPassword: true })
  expect(f.credentials.get(id)).toEqual({})
  expect(await fs.readFile(f.servers.get(id).config.args.at(-1), 'utf8')).not.toContain('${MOSS_DATABASE_PASSWORD}')
}))

test('custom DSNs are encrypted host inputs and blank edits preserve them', () => fixture(async f => {
  const dsn = 'postgresql://reader:dsn-secret@example.test/orders?sslmode=require'
  const { savedId: id } = await f.call('save', { ...defaults, title: 'SSL 连接', kind: 'dsn', dsn })
  expect(JSON.stringify(await f.call('list'))).not.toContain(dsn)
  expect(await fs.readFile(f.servers.get(id).config.args.at(-1), 'utf8')).not.toContain(dsn)
  await f.call('save', { ...defaults, title: 'SSL 连接更新', kind: 'dsn', id, dsn: '' })
  expect(f.credentials.get(id).MOSS_DATABASE_DSN).toBe(dsn)
  await expect(f.call('save', { ...defaults, title: 'empty', kind: 'dsn' })).rejects.toThrow('连接地址')
}))

test('SQLite rejects missing and non-database files without creating a database', () => fixture(async f => {
  const file = path.join(f.dataDir, '不存在.db')
  const input = { ...defaults, title: 'SQLite', kind: 'sqlite', file }
  await expect(f.call('save', input)).rejects.toThrow('不存在')
  await expect(fs.stat(file)).rejects.toThrow()
  await fs.writeFile(file, 'not sqlite')
  await expect(f.call('save', input)).rejects.toThrow('有效的 SQLite')
  await fs.rm(file)
  const database = new Database(file); database.exec('CREATE TABLE orders (id INTEGER)'); database.close()
  const saved = await f.call('save', input)
  expect(saved.connections[0].file).toBe(file)
  await fs.rm(file)
  await expect(f.call('inspect', { id: saved.savedId })).rejects.toThrow('不存在')
}))

test('editing is atomic when host persistence fails; toggling/removal preserve database files', () => fixture(async f => {
  const saved = await f.call('save', postgres), id = saved.savedId
  const file = f.servers.get(id).config.args.at(-1), original = await fs.readFile(file, 'utf8')
  await f.call('set-enabled', { id, enabled: false })
  await expect(f.call('inspect', { id })).rejects.toThrow('启用')
  await f.call('set-enabled', { id, enabled: true })
  expect((await f.call('inspect', { id })).connections[0].status).toBe('connected')
  f.fail()
  await expect(f.call('save', { ...postgres, id, title: 'should fail' })).rejects.toThrow('save failed')
  expect(f.servers.get(id).config.args.at(-1)).toBe(file)
  expect(await fs.readFile(file, 'utf8')).toBe(original)
  expect(await fs.readdir(path.dirname(file))).toHaveLength(1)
  await f.call('remove', { id })
  expect((await f.call('list')).connections).toEqual([])
  await expect(f.call('save', { ...postgres, id })).rejects.toThrow('删除')
}))

test('legacy external configuration is retained and can be replaced in the editor', () => fixture(async f => {
  const file = path.join(f.dataDir, 'user-config.toml')
  await fs.writeFile(file, 'external configuration')
  f.servers.set('database', { name: 'database', enabled: true, config: { command: 'npx', args: ['--config', file], env: { MOSS_DATABASE_DSN: '' } } })
  f.credentials.set('database', { MOSS_DATABASE_DSN: 'postgres://user:legacy@example.test/db' })
  expect((await f.call('list')).connections[0].legacy).toBe(true)
  await f.call('save', { ...defaults, title: '迁移的连接', kind: 'dsn', id: 'database' })
  expect((await f.call('list')).connections[0].legacy).toBe(false)
  expect(f.credentials.get('database').MOSS_DATABASE_DSN).toContain('legacy')
  expect(await fs.readFile(file, 'utf8')).toBe('external configuration')
}))

test('invalid options and configuration injection are rejected before registration', () => fixture(async f => {
  for (const input of [{ host: 'host/path' }, { host: '${PASSWORD}' }, { title: 'a\n[[sources]]' }, { maxRows: 0 }, { readonly: 'true' }, { port: 65536 }]) {
    await expect(f.call('save', { ...postgres, ...input })).rejects.toThrow()
  }
  expect(f.servers.size).toBe(0)
}))
