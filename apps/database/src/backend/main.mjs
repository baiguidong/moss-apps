import { AppBackendClient } from '@moss/app-sdk'
import { createMcpClient } from '@moss/app-sdk/mcp'
import { DatabaseService } from './service.mjs'

const backend = new AppBackendClient()
const client = createMcpClient(backend.host)
const service = new DatabaseService((method, input, signal) => client.request(method, input, { signal, timeoutMs: method === 'servers.inspect' ? 290000 : 60000 }))
for (const method of ['list', 'save', 'inspect', 'remove', 'set-enabled']) {
  backend.registerAction(`connections.${method}`, async (input, context) => {
    try { return { ok: true, data: await service.run(method, input, context) } }
    catch (error) {
      let message = String(error?.message || '操作失败，请重试。')
      for (const value of [input?.password, input?.dsn, input?.password && encodeURIComponent(input.password)]) {
        if (value) message = message.split(value).join('[已隐藏]')
      }
      return { ok: false, error: message.slice(0, 1200) }
    }
  })
}
backend.start()
