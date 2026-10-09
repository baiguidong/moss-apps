import type { Catalog, Input, Method, McpServer } from '../contracts'
import { BUILTIN_SERVERS, validateBuiltinAction, withBuiltins } from '../builtins'
const now = Date.now()
let servers: McpServer[] = [
  { name: 'design-library', enabled: true, updatedAt: now, config: { type: 'http', url: 'https://design.example.com/mcp', headers: { Authorization: '' } }, check: { state: 'connected', checkedAt: now, durationMs: 142, serverInfo: { name: 'Design Library', version: '1.2.0' }, tools: [
    { name: 'search_components', description: '按名称、用途或关键词查找设计组件，获取组件规范与使用示例。', disabled: false },
    { name: 'get_design_tokens', description: '读取设计系统中的颜色、字体、间距与圆角，保持界面风格一致。', disabled: false },
    { name: 'get_component_details', description: '查看组件的属性、交互状态与可访问性要求。', disabled: false },
    { name: 'list_collections', description: '浏览团队维护的组件集合与设计资源。', disabled: false },
  ] } },
  { name: 'workspace-files', enabled: true, updatedAt: now, config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'] } },
  { name: 'team-notes', enabled: true, updatedAt: now, config: { type: 'http', url: 'https://notes.example.com/mcp' }, check: { state: 'needs-auth', tools: [], checkedAt: now } },
  ...BUILTIN_SERVERS.map(server => ({ ...structuredClone(server), updatedAt: now })),
  { name: 'legacy-search', enabled: false, updatedAt: now, config: { type: 'sse', url: 'https://search.example.com/sse' } },
]
export async function demoRequest(method: Method, input: Input): Promise<Catalog> {
  await new Promise(resolve => setTimeout(resolve, 160))
  validateBuiltinAction(method, input)
  const item = servers.find(server => server.name === input.name)
  if (method === 'servers.save') {
    if (servers.some(server => server.name === input.name && server.name !== input.previousName)) throw new Error('已有同名服务。')
    servers = servers.filter(server => server.name !== input.previousName)
    const config = structuredClone(input.config!)
    for (const field of ['env', 'headers'] as const) if (config[field]) config[field] = Object.fromEntries(Object.keys(config[field]!).map(key => [key, '']))
    servers.push({ name: input.name!, enabled: input.enabled!, config, updatedAt: Date.now() })
  } else if (method === 'servers.remove') servers = servers.filter(server => server.name !== input.name)
  else if (method === 'servers.set-enabled' && item) item.enabled = input.enabled!
  else if (method === 'servers.inspect' && item) item.check = { state: 'connected', checkedAt: Date.now(), durationMs: 136, tools: item.check?.tools.length ? item.check.tools : [{ name: 'search', description: '搜索该服务提供的内容。', disabled: false }] }
  else if (method === 'auth.start' && item) item.check = { state: 'authorized', tools: [], checkedAt: Date.now() }
  else if (method === 'auth.clear' && item) item.check = null
  return withBuiltins(structuredClone({ servers }))
}
