import { useEffect, useState } from 'react'
import { ArrowRight, Brain, ChevronLeft, ChevronRight, CircleDot, List, Loader2, Network, RefreshCw, Search, X } from 'lucide-react'
import type { MemoryEntity, MemoryRelation } from '../contracts'
import { GRAPH_PAGE_SIZE } from '../lib/graph-data'
import { typeColor } from '../lib/graph-colors'
import { useMemoryGraph } from '../lib/use-memory-graph'
import { GraphCanvas } from './memory-graph-canvas'
import './memory-graph.css'

function EntityDetails({ entity, relations, onSelect, onClose }: { entity: MemoryEntity | undefined; relations: MemoryRelation[]; onSelect: (name: string) => void; onClose: () => void }) {
  if (!entity) return <aside className="graph-details graph-details-placeholder"><span><Brain size={25} /></span><h3>每段记忆都有线索</h3><p>点击一个节点，查看保存的内容和关联记忆。</p></aside>
  const linked = relations.filter(relation => relation.from === entity.name || relation.to === entity.name)
  return <aside className="graph-details" aria-label="记忆详情">
    <div className="graph-detail-heading"><span className="graph-type-badge" style={{ color: typeColor(entity.entityType) }}>{entity.entityType || '未分类'}</span><button className="icon-button" onClick={onClose} aria-label="关闭记忆详情"><X size={15} /></button></div>
    <h3>{entity.name || '未命名记忆'}</h3>
    <h4>记忆内容 <span>{entity.observations.length}</span></h4>
    {entity.observations.length ? <ul className="graph-observations">{entity.observations.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p className="memory-note">这条记忆还没有补充内容。</p>}
    <h4>当前图中的关联 <span>{linked.length}</span></h4>
    <div className="graph-related">{linked.map((relation, index) => {
      const outgoing = relation.from === entity.name, name = outgoing ? relation.to : relation.from
      return <button key={index} onClick={() => onSelect(name)}><small>{outgoing ? '→' : '←'} {relation.relationType}</small><span>{name}<ArrowRight size={13} /></span></button>
    })}</div>
    {!linked.length && <p className="memory-note">当前视图中没有关联，可清除筛选查看更多记忆。</p>}
    <p className="graph-edit-note">需要补充或更正？在对话中选择记忆 App，告诉 Moss 要修改的内容。</p>
  </aside>
}

export function MemoryGraphView({ available }: { available: boolean }) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [entityType, setEntityType] = useState('')
  const [offset, setOffset] = useState(0), [view, setView] = useState<'graph' | 'list'>('graph'), [selected, setSelected] = useState<string | null>(null)
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setOffset(0) }, 250); return () => clearTimeout(timer) }, [search])
  const { graph, loading, error, refresh } = useMemoryGraph({ query, entityType, offset }, available)
  useEffect(() => { if (graph && !graph.entities.some(entity => entity.name === selected)) setSelected(null) }, [graph, selected])
  const entity = graph?.entities.find(item => item.name === selected)
  const clear = () => { setSearch(''); setQuery(''); setEntityType(''); setOffset(0) }
  return <section className="memory-card graph-card" aria-label="记忆图谱" aria-busy={loading}>
    <div className="graph-heading"><div><h2><Network size={19} />记忆图谱</h2><p>查看保存的内容和它们之间的联系</p></div><button className="button" onClick={() => void refresh()} disabled={loading || !available}><RefreshCw size={14} className={loading ? 'spin' : ''} />刷新记忆</button></div>
    <div className="graph-toolbar"><div className="search-field"><Search size={15} /><input value={search} maxLength={200} onChange={event => setSearch(event.target.value)} aria-label="搜索记忆" placeholder="搜索名称、类型或记忆内容" />{search && <button className="icon-button" aria-label="清除搜索" onClick={() => setSearch('')}><X size={14} /></button>}</div>
      <select aria-label="筛选记忆类型" value={entityType} onChange={event => { setEntityType(event.target.value); setOffset(0) }}><option value="">全部类型</option>{graph?.types.filter(type => type.name).map(type => <option key={type.name} value={type.name}>{type.name}（{type.count}）</option>)}</select>
      <div className="graph-view-switch" aria-label="展示方式"><button aria-pressed={view === 'graph'} onClick={() => setView('graph')}><Network size={14} />图谱</button><button aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14} />列表</button></div>
    </div>
    {error && <p className="memory-error graph-error" role="alert">{graph ? '刷新失败，当前显示上次读取的内容。' : ''}{error}</p>}
    {!available ? <div className="graph-empty"><CircleDot size={30} /><h3>记忆 App 暂未运行</h3><p>启用 App 后即可查看保存的记忆。</p></div>
      : !graph ? <div className="graph-empty">{loading ? <Loader2 className="spin" size={28} /> : <Brain size={28} />}<h3>{loading ? '正在读取记忆…' : '暂时无法读取图谱'}</h3>{!loading && <button className="button" onClick={() => void refresh()}>重新读取</button>}</div>
      : !graph.entities.length ? <div className="graph-empty"><span className="graph-empty-icon"><Network size={31} /></span><h3>{graph.totalEntities ? '没有匹配的记忆' : '第一段记忆，从一句话开始'}</h3><p>{graph.totalEntities ? '试试其他关键词，或清除筛选查看全部记忆。' : '在对话中选择记忆 App，试着对 Moss 说：'}</p>{graph.totalEntities ? <button className="button" onClick={clear}>清除筛选</button> : <blockquote>记住：小林负责咖啡店网站项目，目前处于设计阶段。<small>保存后，人物、项目和关系会出现在这里。</small></blockquote>}</div>
      : <div className="graph-explorer"><div className="graph-primary">
        {view === 'graph' ? <GraphCanvas graph={graph} selected={selected} onSelect={setSelected} /> : <div className="graph-list" aria-label="记忆列表">{graph.entities.map(item => <button key={item.name} onClick={() => setSelected(item.name)} aria-pressed={item.name === selected}><span className="graph-list-dot" style={{ background: typeColor(item.entityType) }} /><div><strong>{item.name || '未命名记忆'}</strong><p>{item.observations[0] || '暂无补充内容'}</p><small>{item.entityType || '未分类'} · {item.observations.length} 条内容</small></div><ChevronRight size={15} /></button>)}</div>}
      </div><EntityDetails entity={entity} relations={graph.relations} onSelect={setSelected} onClose={() => setSelected(null)} /></div>}
    {graph && <div className="graph-footer"><span aria-live="polite">共 {graph.totalEntities} 条记忆 · {graph.totalRelations} 条关系{(query || entityType) && ` · 匹配 ${graph.totalMatches} 条`}</span>
      {(graph.nextOffset !== null || graph.offset > 0) ? <div className="graph-pagination"><small>显示 {graph.offset + 1}–{graph.offset + graph.entities.length}</small><button className="icon-button" aria-label="上一页记忆" disabled={!graph.offset || loading} onClick={() => setOffset(Math.max(0, graph.offset - GRAPH_PAGE_SIZE))}><ChevronLeft size={16} /></button><button className="icon-button" aria-label="下一页记忆" disabled={graph.nextOffset === null || loading} onClick={() => setOffset(graph.nextOffset!)}><ChevronRight size={16} /></button></div>
        : <small>{graph.updatedAt ? `最近保存 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(graph.updatedAt)}` : '记忆保存在此设备'}</small>}
    </div>}
    {!!graph?.unresolvedRelations && <p className="memory-note graph-warning">有 {graph.unresolvedRelations} 条关系缺少对应节点，暂未画出；可在对话中整理这些关系。</p>}
  </section>
}
