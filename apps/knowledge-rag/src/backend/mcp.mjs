import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export function decodeToolResult(result) {
  const texts = (result.content || []).filter(item => item.type === 'text').map(item => item.text)
  let data
  try { data = JSON.parse(texts.join('\n')) }
  catch { data = result.structuredContent }
  if (result.isError || data?.status === 'error' || data?.error) throw new Error(String(data?.message || data?.error || texts.join('\n') || '知识库操作失败').slice(0, 3000))
  if (!data || typeof data !== 'object') throw new Error('知识库返回了无法识别的数据')
  return data
}

export async function connectEngine(url, token, signal) {
  const client = new Client({ name: 'moss-knowledge-rag-ui', version: '0.1.1' })
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  try {
    await client.connect(transport, { signal, timeout: 15000 })
    return { client, async close() { await client.close() }, async call(name, args = {}, options = {}) {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: options.timeoutMs || 60000, signal: options.signal })
      return decodeToolResult(result)
    } }
  } catch (error) { await transport.close().catch(() => {}); throw error }
}
