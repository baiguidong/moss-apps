import { DEFAULT_CONFIG, PLAYWRIGHT_CDP } from '../browser-config'
import type { Catalog, Input, Method } from '../contracts'
let catalog: Catalog = { preparation: { state: 'ready' }, servers: [{
  name: PLAYWRIGHT_CDP, enabled: true, updatedAt: Date.now(), config: DEFAULT_CONFIG, credentialsMissing: false,
  check: { state: 'connected', checkedAt: Date.now(), tools: [
    { name: 'browser_navigate', description: '打开网页并读取页面内容。', disabled: false },
    { name: 'browser_click', description: '点击页面上的按钮、链接或其他元素。', disabled: false },
    { name: 'browser_type', description: '填写输入框，完成网页表单。', disabled: false },
    { name: 'browser_take_screenshot', description: '截取当前页面，记录操作结果。', disabled: false },
  ] },
}] }
export async function demoRequest(method: Method, input: Input): Promise<Catalog> {
  await new Promise(resolve => setTimeout(resolve, 120))
  const server = catalog.servers[0]
  if (method === 'servers.save' && input.config) {
    server.config = structuredClone(input.config); server.updatedAt = Date.now()
    for (const tool of server.check?.tools || []) tool.disabled = input.config.disabledTools?.includes(tool.name) || false
  }
  if (method !== 'servers.list' && server.check) server.check.checkedAt = Date.now()
  return structuredClone(catalog)
}
