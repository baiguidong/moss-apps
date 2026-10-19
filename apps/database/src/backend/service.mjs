import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'

const marker = '# moss-database-v1 '
const defaults = { title: '', kind: 'postgres', host: 'localhost', port: 5432, database: '', username: '', file: '', readonly: true, maxRows: 1000, timeout: 10 }
export { defaults }
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const configPath = server => server.config?.args?.[server.config.args.indexOf('--config') + 1]
const expandHome = file => file?.startsWith('~/') ? path.join(homedir(), file.slice(2)) : file

// Return actionable categories without echoing connection strings or credentials.
export function connectionError(error) {
  const message = String(error || '')
  if (/Cannot find (?:module|package)|required dependency|No connector found/i.test(message)) return '数据库驱动未能加载，请修复 DBHub 运行依赖后重新测试。'
  if (/Unknown database|ER_BAD_DB_ERROR|3D000/i.test(message)) return '指定的数据库不存在。请填写已有数据库名称；命令行未指定数据库时能登录，并不代表该数据库存在。'
  if (/Access denied|authentication failed|password authentication|ER_ACCESS_DENIED_ERROR/i.test(message)) return '数据库拒绝登录。请检查已保存的用户名、密码及该账号的访问权限。'
  if (/ECONNREFUSED/i.test(message)) return '数据库端口拒绝连接。请检查主机地址、端口及数据库服务是否已启动。'
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return '无法解析数据库主机名。请检查主机地址和网络。'
  if (/ETIMEDOUT|timed out|timeout/i.test(message)) return '连接超时。请检查网络、VPN、防火墙及数据库访问权限后重试。'
  if (/Connection closed/i.test(message)) return '数据库服务在启动时退出（MCP -32000）。请检查 DBHub 驱动依赖、数据库名称和连接信息后重试。'
  return '连接未成功。请检查驱动依赖、数据库名称、地址、端口和账号权限后重试。'
}

function validate(input) {
  const model = Object.fromEntries(Object.keys(defaults).map(key => [key, input[key] ?? defaults[key]]))
  for (const key of ['title', 'host', 'database', 'username', 'file']) {
    if (typeof model[key] !== 'string' || /[\x00-\x1f\x7f]/.test(model[key]) || model[key].includes('${')) throw new Error('连接信息含有无效字符。')
    model[key] = model[key].trim()
  }
  if (!model.title || model.title.length > 80) throw new Error('请填写连接名称（最多 80 字）。')
  if (!['postgres', 'mysql', 'mariadb', 'sqlite', 'dsn'].includes(model.kind)) throw new Error('请选择数据库类型。')
  for (const [key, max] of [['port', 65535], ['maxRows', 10000], ['timeout', 300]]) {
    if (!Number.isInteger(model[key]) || model[key] < 1 || model[key] > max) throw new Error(`${{ port: '端口', maxRows: '返回行数', timeout: '查询超时' }[key]}超出允许范围。`)
  }
  if (typeof model.readonly !== 'boolean') throw new Error('查询权限无效。')
  if (!['sqlite', 'dsn'].includes(model.kind)) {
    if (!model.host || !/^(?:[a-zA-Z0-9._-]+|\[[a-fA-F0-9:]+\])$/.test(model.host)) throw new Error('请填写主机名或 IP 地址，不要包含协议、路径或端口。')
    if (!model.database || !model.username) throw new Error('请填写数据库名称和用户名。')
  }
  return model
}

async function existingSqlite(file) {
  if (!path.isAbsolute(file)) throw new Error('请选择已有 SQLite 数据库的绝对路径。')
  const stat = await fs.stat(file).catch(() => null)
  if (!stat?.isFile()) throw new Error('SQLite 文件不存在或不是普通文件，请检查路径。')
  const handle = await fs.open(file, 'r')
  try {
    const header = Buffer.alloc(16)
    await handle.read(header, 0, 16, 0)
    if (header.toString() !== 'SQLite format 3\0') throw new Error('所选文件不是有效的 SQLite 数据库。')
  } finally { await handle.close() }
}

export class DatabaseService {
  constructor(request) { this.request = request; this.queue = Promise.resolve() }
  run(method, input, context) {
    const pending = this.queue.then(() => { context.signal?.throwIfAborted(); return this.handle(method, input, context) })
    this.queue = pending.catch(() => {})
    return pending
  }
  async metadata(server, directory) {
    const file = configPath(server)
    if (!file || path.dirname(file) !== directory || !/^[a-f0-9-]+\.toml$/.test(path.basename(file))) return null
    try {
      const line = (await fs.readFile(file, 'utf8')).split('\n')[0]
      return line.startsWith(marker) ? validate(JSON.parse(line.slice(marker.length))) : null
    } catch { return null }
  }
  async list(catalog, directory) {
    return { connections: await Promise.all(catalog.servers.map(async server => {
      const model = await this.metadata(server, directory)
      return { id: server.name, ...model, title: model?.title || '原有数据库连接', legacy: !model,
        enabled: server.enabled, status: server.check?.state || (server.enabled ? 'unchecked' : 'disabled'),
        error: server.check?.state === 'failed' ? connectionError(server.check.error) : '',
        tools: server.check?.tools?.map(tool => ({ name: tool.name, description: tool.description })) || [] }
    })) }
  }
  async handle(method, input, context) {
    const directory = path.join(context.dataDir, 'connections')
    const request = (method, input) => this.request(method, input, context.signal)
    let catalog = await request('servers.list', {})
    // Retain legacy connections. Only suspend the known broken default when its
    // required file is absent; it can then be configured using the same identity.
    if (method === 'list') {
      for (const server of catalog.servers) {
        if (server.enabled && server.name === 'database' && configPath(server) === '~/moss-database.toml'
            && !(await fs.stat(expandHome(configPath(server))).catch(error => { if (error.code !== 'ENOENT') throw error; return null }))) {
          catalog = await request('servers.set-enabled', { name: server.name, enabled: false })
        }
      }
      return this.list(catalog, directory)
    }
    const previous = input.id && catalog.servers.find(server => server.name === input.id)
    if (input.id && !previous || method !== 'save' && !previous) throw new Error('连接已被删除，请刷新后重试。')
    if (method === 'save') {
      const model = validate(input)
      const old = previous && await this.metadata(previous, directory)
      const env = {}
      let dsn
      if (model.kind === 'sqlite') {
        model.file = expandHome(model.file)
        await existingSqlite(model.file)
        // DBHub expects forward slashes and a leading slash before a Windows drive.
        // Keep path characters literal: its SQLite DSN parser does not URL-decode them.
        const sqlitePath = process.platform === 'win32' ? model.file.replaceAll('\\', '/') : model.file
        dsn = `sqlite://${sqlitePath.startsWith('/') ? '' : '/'}${sqlitePath}`
      } else if (model.kind === 'dsn') {
        const value = String(input.dsn || '').trim()
        if (!value && !(previous?.config.env && Object.hasOwn(previous.config.env, 'MOSS_DATABASE_DSN'))) throw new Error('请填写数据库连接地址。')
        if (value) {
          let url
          try { url = new URL(value) } catch { throw new Error('连接地址格式无效。') }
          if (!['postgres:', 'postgresql:', 'mysql:', 'mariadb:', 'sqlserver:', 'mssql:', 'oracle:', 'sqlite:'].includes(url.protocol) || /[\x00-\x1f]/.test(value) || value.includes('${')) throw new Error('不支持此数据库连接地址。')
          if (url.protocol !== 'sqlite:' && !url.hostname) throw new Error('连接地址中缺少数据库主机。')
          if (url.protocol === 'sqlite:') await existingSqlite(value.slice('sqlite://'.length))
        }
        env.MOSS_DATABASE_DSN = value
        dsn = '${MOSS_DATABASE_DSN}'
      } else {
        if (input.clearPassword && input.password) throw new Error('清除密码和填写新密码不能同时进行。')
        // Keep an existing encoded password when the editor submits a blank field.
        // Changing database types requires entering the new connection credentials.
        env.MOSS_DATABASE_PASSWORD = input.clearPassword ? '' : encode(String(input.password || ''))
        if (input.clearPassword || old?.kind !== model.kind) {
          // A separate empty variable avoids the Host's blank-means-preserve rule.
          if (!input.password) delete env.MOSS_DATABASE_PASSWORD
        }
        const password = Object.hasOwn(env, 'MOSS_DATABASE_PASSWORD') ? '${MOSS_DATABASE_PASSWORD}' : ''
        dsn = `${model.kind}://${encode(model.username)}:${password}@${model.host}:${model.port}/${encode(model.database)}`
      }
      const toml = `${marker}${JSON.stringify(model)}\n[[sources]]\nid = "default"\ndescription = ${JSON.stringify(model.title)}\ndsn = ${JSON.stringify(dsn)}\nquery_timeout = ${model.timeout}\n\n[[tools]]\nname = "search_objects"\nsource = "default"\n\n[[tools]]\nname = "execute_sql"\nsource = "default"\nreadonly = ${model.readonly}\nmax_rows = ${model.maxRows}\n`
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      const file = path.join(directory, `${randomUUID()}.toml`)
      await fs.writeFile(file, toml, { mode: 0o600, flag: 'wx' })
      const name = previous?.name || `db_${randomUUID().replaceAll('-', '').slice(0, 16)}`
      try {
        catalog = await request('servers.save', { name, ...(previous ? { previousName: name } : {}), enabled: old ? previous.enabled : true,
          config: { type: 'stdio', command: process.platform === 'win32' ? 'cmd' : 'npx',
            args: [...(process.platform === 'win32' ? ['/c', 'npx'] : []), '-y', '@bytebase/dbhub@1.5.0', '--transport', 'stdio', '--config', file], env } })
      } catch (error) { await fs.rm(file, { force: true }); throw error }
      // Files are immutable per revision: failed saves cannot break a live connection.
      return { ...await this.list(catalog, directory), savedId: name }
    }
    if (method === 'inspect' || method === 'set-enabled' && input.enabled) {
      const file = expandHome(configPath(previous))
      if (!file || !(await fs.stat(file).catch(() => null))?.isFile()) throw new Error('连接配置文件不存在，请编辑连接并保存，由 App 重新生成配置。')
      const model = await this.metadata(previous, directory)
      if (model?.kind === 'sqlite') await existingSqlite(model.file)
    }
    if (method === 'inspect' && !previous.enabled) throw new Error('请先启用连接，再测试。')
    if (!['inspect', 'remove', 'set-enabled'].includes(method)) throw new Error('不支持的操作。')
    catalog = await request(`servers.${method}`, { name: previous.name, ...(method === 'set-enabled' ? { enabled: input.enabled } : {}) })
    return this.list(catalog, directory)
  }
}
