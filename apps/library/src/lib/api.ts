import type { AppUiApi } from '@moss/app-sdk'
declare global { interface Window { mossApp?: AppUiApi } }
export interface Collection { id: string; name: string; description: string; resourceCount: number }
export interface Document { id: string; resourceId?: string; title: string; sourceId: string; relativePath: string; extension: string; status: string; revision: string; currentRevision?: string; editable?: boolean; content?: string; snippet?: string; nextOffset?: number | null; error?: string }
export interface Job { id: string; sourceId: string; status: string; error: string; progress: { indexed?: number; discovered?: number; failed?: number; currentTitle?: string } }
export interface Source { id: string; name: string; status: string; error: string }
export interface Api { demo: boolean; request<T = unknown>(name: string, input?: Record<string, unknown>): Promise<T>; subscribe(fn: () => void): () => void }
export function createHostApi(bridge: AppUiApi): Api {
  let instance: Promise<string> | undefined
  const id = () => instance ??= bridge.instances.list().then(items => {
    if (!items[0]) throw new Error('知识库尚未启用，请在应用管理中启用。')
    return String(items[0].id)
  }).catch(e => { instance = undefined; throw e })
  return {
    demo: false,
    async request<T>(name: string, input: Record<string, unknown> = {}) {
      const instanceId = await id()
      const invoke = (args: Record<string, unknown>) => bridge.actions.invoke(instanceId, name, args, { timeoutMs: 300000 }) as Promise<{ data?: T; nextOffset?: number | null }>
      const result = await invoke(input)
      if ((name === 'collections.list' || name === 'sources.list') && input.offset === undefined && input.limit === undefined && Array.isArray(result.data)) {
        const items = [...result.data]
        let offset = result.nextOffset
        while (offset != null) {
          const next = await invoke({ ...input, offset })
          if (!Array.isArray(next.data)) break
          items.push(...next.data)
          if (next.nextOffset == null || next.nextOffset <= offset) break
          offset = next.nextOffset
        }
        return items as T
      }
      return (Object.hasOwn(result, 'data') ? result.data : result) as T
    },
    subscribe(fn) {
      const stops = [bridge.events.on('library.changed', fn), bridge.events.on('runtime', fn)]
      return () => stops.forEach(stop => stop())
    },
  }
}
export function createDemoApi(): Api {
  let collections: Collection[] = [{ id: 'demo', name: '我的资料', description: '', resourceCount: 1 }]
  let docs = [{ id: 'welcome', sourceId: 'demo', collectionId: 'demo', title: '开始整理你的知识', relativePath: '欢迎.md', extension: '.md', status: 'ready', revision: '1', editable: true, content: '# 随时查阅，持续积累\n\n将产品文档、会议记录和研究资料整理到资料集中。\n\n搜索默认覆盖全部资料集，也可以选择某一个资料集。\n\n在 Moss 中安装知识库 App，即可导入本地文件并使用全文搜索。' }]
  const listeners = new Set<() => void>()
  return { demo: true, subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    async request<T>(name: string, input: Record<string, unknown> = {}) {
      let result: unknown
      const selected = docs.filter(d => !Array.isArray(input.collectionIds) || !input.collectionIds.length || input.collectionIds.includes(d.collectionId))
      switch (name) {
        case 'collections.list': result = collections.map(c => ({ ...c, resourceCount: docs.filter(d => d.collectionId === c.id).length })); break
        case 'collections.create': { const c = { id: crypto.randomUUID(), name: String(input.name), description: '', resourceCount: 0 }; collections.push(c); result = c; break }
        case 'collections.update': collections = collections.map(c => c.id === input.id ? { ...c, name: String(input.name) } : c); break
        case 'collections.delete': collections = collections.filter(c => c.id !== input.id); docs = docs.filter(d => d.collectionId !== input.id); break
        case 'documents.list': result = selected; break
        case 'documents.search': result = selected.filter(d => (d.title + d.content).toLowerCase().includes(String(input.query).toLowerCase())).map(d => ({ ...d, resourceId: d.id, snippet: d.content.slice(0, 160) })); break
        case 'documents.read': result = docs.find(d => d.id === input.resourceId); break
        case 'documents.create': { const d = { id: crypto.randomUUID(), sourceId: 'demo', collectionId: String(input.collectionId), title: String(input.title), relativePath: `${input.title}.md`, extension: '.md', status: 'ready', revision: crypto.randomUUID(), editable: true, content: String(input.content) }; docs.push(d); result = { resource: d }; break }
        case 'documents.update': docs = docs.map(d => d.id === input.resourceId ? { ...d, title: String(input.title ?? d.title), content: String(input.content), revision: crypto.randomUUID() } : d); break
        case 'documents.delete': docs = docs.filter(d => d.id !== input.resourceId); break
        case 'status.get': result = { pythonAvailable: true }; break
        case 'jobs.list': case 'sources.list': result = []; break
        case 'local.pick': throw new Error('请在 Moss 中安装此 App 后导入本地文件。')
        default: throw new Error('此操作需要在 Moss 中使用。')
      }
      if (['create', 'update', 'delete'].some(v => name.endsWith(v))) listeners.forEach(fn => fn())
      return result as T
    },
  }
}
