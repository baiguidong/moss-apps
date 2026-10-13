import { useEffect, useRef, useState } from 'react'
import type { Graph, IElementEvent } from '@antv/g6'
import { Loader2, Maximize2, Minus, Plus } from 'lucide-react'
import type { MemoryGraph } from '../contracts'
import { typeColor, typePalette } from '../lib/graph-colors'

export function GraphCanvas({ graph, selected, onSelect }: { graph: MemoryGraph; selected: string | null; onSelect: (name: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null), engine = useRef<Graph | null>(null)
  const selection = useRef(selected)
  selection.current = selected
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [zoom, setZoom] = useState(1)
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  const applySelection = useRef<() => void>(() => {})
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let disposed = false, rendered = false, instance: Graph | undefined
    setReady(false); setError('')
    const nodes = graph.entities.map((entity, index) => ({ id: `memory-${index}`, entity }))
    const byName = new Map(nodes.map(node => [node.entity.name, node.id]))
    const byId = new Map(nodes.map(node => [node.id, node.entity.name]))
    const edges = graph.relations.map((relation, index) => ({ id: `relation-${index}`, source: byName.get(relation.from)!, target: byName.get(relation.to)!, data: { name: relation.relationType } }))
    const degree = new Map<string, number>()
    for (const edge of edges) for (const id of [edge.source, edge.target]) degree.set(id, (degree.get(id) || 0) + 1)
    const highlight = () => {
      if (!rendered || disposed || !instance) return
      const selectedId = selection.current === null ? undefined : byName.get(selection.current)
      const related = new Set<string>()
      for (const edge of edges) if (edge.source === selectedId || edge.target === selectedId) { related.add(edge.source); related.add(edge.target) }
      const states = Object.fromEntries([
        ...nodes.map(node => [node.id, !selectedId ? [] : node.id === selectedId ? ['selected'] : related.has(node.id) ? [] : ['inactive']]),
        ...edges.map(edge => [edge.id, !selectedId ? [] : edge.source === selectedId || edge.target === selectedId ? ['active'] : ['inactive']]),
      ])
      void instance.setElementState(states, false).catch(() => {})
    }
    applySelection.current = highlight
    void (async () => {
      const { Graph, NodeEvent, CanvasEvent, GraphEvent } = await import('@antv/g6')
      if (disposed || !container.current) return
      const foreground = dark ? '#e8efeb' : '#33483f', muted = dark ? '#a7b9b0' : '#7a8a83', surface = dark ? '#202e26' : '#fafcf8'
      instance = new Graph({
        container: container.current, autoResize: true, animation: false, padding: [65, 65, 70, 65], zoomRange: [.12, 2.5],
        data: { nodes: nodes.map(({ id, entity }) => {
          const palette = typePalette(entity.entityType)
          return { id, data: { name: entity.name }, style: {
            size: Math.min(72, 48 + (degree.get(id) || 0) * 5), fill: dark ? palette.darkFill : palette.fill,
            stroke: palette.stroke, lineWidth: 1.6, shadowColor: dark ? '#00000030' : '#2c483c0a', shadowBlur: 12, shadowOffsetY: 3,
            iconText: [...(entity.name || '记')].slice(0, 1).join(''), iconFill: palette.stroke, iconFontSize: 20, iconFontWeight: 500,
            labelText: entity.name || '未命名记忆', labelFill: foreground, labelPlacement: 'bottom', labelOffsetY: 10,
            labelFontSize: 12, labelFontWeight: 500, labelWordWrap: true, labelMaxWidth: 130, labelMaxLines: 2,
            haloStroke: palette.stroke, haloLineWidth: 12, haloStrokeOpacity: .12, cursor: 'pointer',
          } }
        }), edges },
        node: { type: 'circle', state: {
          selected: data => ({ halo: true, lineWidth: 2.6, stroke: data.style?.stroke, haloStroke: data.style?.stroke, haloLineWidth: 10, haloStrokeOpacity: .13 }),
          inactive: { opacity: .6 },
        } },
        edge: { type: 'quadratic', style: {
          stroke: dark ? '#698176' : '#a3b8aa', lineWidth: 1.2, endArrow: true, endArrowSize: 6,
          labelText: data => String(data.data?.name || ''), labelFill: muted, labelFontSize: 10,
          labelBackground: true, labelBackgroundFill: surface, labelBackgroundRadius: 4, labelPadding: [3, 6],
          labelAutoRotate: false, labelWordWrap: true, labelMaxWidth: 100, labelMaxLines: 2,
        }, state: { active: { stroke: '#5c9b7c', lineWidth: 2, labelFill: foreground }, inactive: { opacity: .5 } } },
        layout: { type: 'd3-force', preLayout: true, iterations: 240, link: { distance: 155, strength: .65 }, manyBody: { strength: -480 }, collide: { radius: 63 }, x: { strength: .025 }, y: { strength: .035 } },
        transforms: [{ type: 'process-parallel-edges', mode: 'bundle', distance: 24 }],
        behaviors: ['drag-canvas', 'drag-element', { type: 'zoom-canvas', trigger: ['Control'], sensitivity: .8 }],
      })
      engine.current = instance
      instance.on(NodeEvent.CLICK, (event: IElementEvent) => { const name = byId.get(event.target.id); if (name !== undefined) onSelect(name) })
      instance.on(CanvasEvent.CLICK, () => onSelect(null))
      // G6 emits an initial transform while its viewport controller is being constructed.
      instance.on(GraphEvent.AFTER_TRANSFORM, () => { if (rendered && !disposed && instance) setZoom(instance.getZoom()) })
      await instance.render()
      if (disposed) return
      await instance.fitView({ when: 'always' }, false)
      if (disposed) return
      rendered = true; setReady(true); setZoom(instance.getZoom()); highlight()
    })().catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : '图谱暂时无法显示') })
    const observer = new ResizeObserver(() => { if (rendered && instance && !disposed) instance.resize() })
    if (container.current) observer.observe(container.current)
    return () => {
      disposed = true; rendered = false; observer.disconnect(); applySelection.current = () => {}
      if (engine.current === instance) engine.current = null
      instance?.destroy()
    }
  }, [graph, dark, onSelect])
  useEffect(() => { applySelection.current() }, [selected])
  const visibleTypes = [...new Set(graph.entities.map(entity => entity.entityType))]
  return <div className="memory-flow" data-engine="antv-g6" data-ready={ready} data-node-count={ready ? graph.entities.length : 0} data-edge-count={ready ? graph.relations.length : 0}>
    <div ref={container} className="g6-container" role="img" aria-label={`记忆关系图，${graph.entities.length} 个节点、${graph.relations.length} 条关系；可切换列表查看`} />
    {!ready && <div className="graph-render-status">{error ? <p>图谱暂时无法显示，请切换列表查看记忆。<small>{error}</small></p> : <><Loader2 size={23} className="spin" /><span>正在整理关系…</span></>}</div>}
    <div className="graph-legend">{visibleTypes.slice(0, 6).map(type => <span key={type}><i style={{ background: typeColor(type) }} />{type || '未分类'}</span>)}</div>
    <div className="graph-canvas-controls"><button className="icon-button" aria-label="放大图谱" disabled={!ready} onClick={() => void engine.current?.zoomBy(1.25, false)}><Plus size={16} /></button><button className="icon-button" aria-label="缩小图谱" disabled={!ready} onClick={() => void engine.current?.zoomBy(.8, false)}><Minus size={16} /></button><span aria-label="图谱缩放比例">{Math.round(zoom * 100)}%</span><button className="icon-button" aria-label="适应画布" disabled={!ready} onClick={() => void engine.current?.fitView({ when: 'always' }, false)}><Maximize2 size={15} /></button></div>
    <div className="graph-node-navigation" aria-label="键盘选择记忆">{graph.entities.map(entity => <button key={entity.name} aria-label={`选中记忆：${entity.name}`} onClick={() => onSelect(entity.name)}>{entity.name}</button>)}</div>
    <span className="graph-canvas-hint">拖动节点与画布 · Ctrl + 滚轮缩放</span>
  </div>
}
