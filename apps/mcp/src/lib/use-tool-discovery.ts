import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Catalog, McpServer } from '../contracts'
import { request } from './api'

const revision = (server?: McpServer) => server ? JSON.stringify([server.name, server.enabled, server.updatedAt, server.config]) : ''
const needsTools = (server?: McpServer) => Boolean(server?.enabled && !server.credentialsMissing
  && (!server.check || ['unchecked', 'authorized'].includes(server.check.state)))

/** Inspect the visible service without blocking edits or replacing newer catalog data. */
export function useToolDiscovery(server: McpServer | undefined, blocked: boolean, setCatalog: Dispatch<SetStateAction<Catalog | null>>) {
  const key = revision(server), name = server?.name, eligible = needsTools(server)
  const attempted = useRef(''), current = useRef<AbortController | null>(null)
  const [failure, setFailure] = useState({ key: '', message: '' })
  useEffect(() => {
    if (!eligible || blocked || !name || attempted.current === key) return
    const controller = new AbortController(); current.current = controller; attempted.current = key
    let finished = false
    void request('servers.inspect', { name }, controller.signal).then(result => {
      if (controller.signal.aborted) return
      const inspected = result.servers.find(item => item.name === name)
      if (!inspected?.check || ['unchecked', 'authorized'].includes(inspected.check.state)) throw new Error('服务未返回工具目录，请重试。')
      if (revision(inspected) !== key) throw new Error('连接配置已变化，请刷新服务列表。')
      setCatalog(catalog => catalog && ({ ...catalog, servers: catalog.servers.map(item =>
        revision(item) === key && needsTools(item) ? { ...item, check: inspected.check } : item) }))
    }).catch(error => {
      if (!controller.signal.aborted) setFailure({ key, message: error instanceof Error ? error.message : '工具目录加载失败，请重试。' })
    }).finally(() => { finished = true; if (current.current === controller) current.current = null })
    return () => {
      const cancelled = controller.signal.aborted
      controller.abort()
      if (!finished && !cancelled && attempted.current === key) attempted.current = ''
      if (current.current === controller) current.current = null
    }
  }, [key, name, eligible, blocked, setCatalog])
  return {
    loading: eligible && !blocked && failure.key !== key,
    error: eligible && failure.key === key ? failure.message : '',
    cancel: () => { current.current?.abort(); setFailure({ key, message: '工具目录加载已取消，可以重新检查连接。' }) },
  }
}
