import { SERVICE, DEFAULT_SETTINGS, type Catalog, type Input, type Method } from '../contracts'
const tools = [["read_text_file", "读取文本文件。"], ["write_file", "写入文件。"], ["edit_file", "预览或应用文本修改。"], ["list_directory", "列出目录。"], ["search_files", "按模式搜索文件。"], ["list_allowed_directories", "查看允许访问的目录。"]]
const catalog: Catalog = { settings: structuredClone(DEFAULT_SETTINGS), preparation: { state: 'ready' }, servers: [] }
export async function demoRequest(method: Method, input: Input): Promise<Catalog> {
  await new Promise(resolve => setTimeout(resolve, 100))
  if (method === 'servers.save') catalog.settings = { ...catalog.settings, ...structuredClone(input) }
  catalog.preparation = { state: 'ready' }
  catalog.servers = [{ name: SERVICE, enabled: true, updatedAt: Date.now(), credentialsMissing: false,
    config: { type: 'stdio', disabledTools: catalog.settings.disabledTools },
    check: { state: 'connected', checkedAt: Date.now(), tools: tools.map(([name, description]) => ({ name, description, disabled: catalog.settings.disabledTools.includes(name) })) } }]
  return structuredClone(catalog)
}
