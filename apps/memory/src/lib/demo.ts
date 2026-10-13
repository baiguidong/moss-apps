import { MEMORY, type Catalog, type Input, type Method } from '../contracts'
import type { GraphInput } from '../contracts'
import { selectGraph } from './graph-data'
const tools = [
  ['create_entities', '创建人物、项目等记忆实体。'], ['create_relations', '关联已有实体。'],
  ['add_observations', '补充已保存实体的信息。'], ['read_graph', '读取完整记忆图谱。'],
  ['search_nodes', '按名称、类型和内容搜索记忆。'], ['open_nodes', '读取指定实体及其关联。'],
  ['delete_entities', '删除实体及关联关系。'], ['delete_observations', '删除指定信息。'], ['delete_relations', '删除指定关系。'],
]
const catalog: Catalog = { memoryFile: '演示数据 / memory / knowledge-graph.jsonl', preparation: { state: 'ready' }, servers: [{
  name: MEMORY, enabled: true, updatedAt: Date.now(), config: { type: 'stdio', disabledTools: [] }, credentialsMissing: false,
  check: { state: 'connected', checkedAt: Date.now(), tools: tools.map(([name, description]) => ({ name, description, disabled: false })) },
}] }
export async function demoRequest(method: Method, input: Input): Promise<Catalog> {
  await new Promise(resolve => setTimeout(resolve, 120))
  const server = catalog.servers[0]
  if (method === 'servers.save') {
    server.config.disabledTools = input.disabledTools || []; server.updatedAt = Date.now()
    for (const tool of server.check!.tools) tool.disabled = server.config.disabledTools.includes(tool.name)
  }
  if (method !== 'servers.list') server.check!.checkedAt = Date.now()
  return structuredClone(catalog)
}
const demoRecords = {
  entities: [
    { name: '咖啡店网站', entityType: '项目', observations: ['目标：让顾客查看菜单、了解门店并在线预约。', '当前进度：设计阶段，已完成首页草图。'] },
    { name: '小林', entityType: '人物', observations: ['咖啡店网站的负责人。', '偏好简洁、有留白的页面设计。'] },
    { name: '晨光咖啡', entityType: '组织', observations: ['一家社区咖啡店，提供手冲咖啡和烘焙甜点。'] },
    { name: '预约功能', entityType: '需求', observations: ['顾客可选择到店日期、时间和人数。', '预约成功后展示确认信息。'] },
    { name: '菜单页面', entityType: '需求', observations: ['展示饮品、价格和季节限定。'] },
    { name: '简洁中文', entityType: '偏好', observations: ['文案使用简洁、自然的中文。'] },
  ],
  relations: [
    { from: '小林', to: '咖啡店网站', relationType: '负责' },
    { from: '咖啡店网站', to: '晨光咖啡', relationType: '服务于' },
    { from: '咖啡店网站', to: '预约功能', relationType: '包含' },
    { from: '咖啡店网站', to: '菜单页面', relationType: '包含' },
    { from: '小林', to: '简洁中文', relationType: '偏好' },
  ],
}
export async function demoGraph(input: GraphInput) { return selectGraph(demoRecords, input) }
