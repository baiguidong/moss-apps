import React, { useCallback, useEffect, useMemo } from 'react'
import { ReactFlow, Controls, MarkerType, Handle, Position, BaseEdge, EdgeLabelRenderer, useReactFlow, useStore, getViewportForBounds, type EdgeProps, type Rect } from '@xyflow/react'
import { useColorMode } from './appearance'
import dagre from '@dagrejs/dagre'
import { Bot, Check, GitFork, LoaderCircle, OctagonX } from 'lucide-react'
import '@xyflow/react/dist/style.css'
const Node = ({ data }: any) => <div className={`flow-node ${data.status ?? ''} ${data.kind}`}>
  <Handle type="target" position={Position.Top} /><div className="node-icon">{data.status === 'running' ? <LoaderCircle className="spin" size={17}/> : data.status === 'completed' ? <Check size={17}/> : data.kind === 'parallel' ? <GitFork size={17}/> : data.kind === 'terminal' ? <OctagonX size={17}/> : <Bot size={17}/>}</div>
  <div><strong>{data.title}</strong><small>{data.id}{data.visits ? ` · ${data.visits} 次执行` : ''}</small></div><Handle type="source" position={Position.Bottom}/>
</div>
const nodeTypes = { takt: Node }
const loopOffset = (lane: number) => 180 + lane * 70
function LoopEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, label, data }: EdgeProps) {
  const right = Math.max(sourceX, targetX) + loopOffset(Number(data?.lane ?? 0))
  const bottom = sourceY + 32, top = targetY - 32
  const path = `M ${sourceX} ${sourceY} L ${sourceX} ${bottom - 12} Q ${sourceX} ${bottom} ${sourceX + 12} ${bottom} L ${right - 12} ${bottom} Q ${right} ${bottom} ${right} ${bottom - 12} L ${right} ${top + 12} Q ${right} ${top} ${right - 12} ${top} L ${targetX + 12} ${top} Q ${targetX} ${top} ${targetX} ${top + 12} L ${targetX} ${targetY}`
  return <><BaseEdge id={id} path={path} markerEnd={markerEnd} style={style}/><EdgeLabelRenderer><span className="loop-label" style={{ transform: `translate(-50%, -50%) translate(${right}px, ${(sourceY + targetY) / 2}px)` }}>{label}</span></EdgeLabelRenderer></>
}
const edgeTypes = { loop: LoopEdge }
// ReactFlow's default fit only considers nodes. Include the outer return lanes and labels.
function FitGraph({ bounds }: { bounds: Rect }) {
  const { setViewport, viewportInitialized } = useReactFlow()
  const width = useStore(s => s.width), height = useStore(s => s.height)
  const { x, y, width: graphWidth, height: graphHeight } = bounds
  const fit = useCallback(() => {
    if (viewportInitialized && width && height) void setViewport(getViewportForBounds({ x, y, width: graphWidth, height: graphHeight }, width, height, .25, 1.2, .2))
  }, [viewportInitialized, width, height, x, y, graphWidth, graphHeight, setViewport])
  useEffect(fit, [fit])
  return <Controls showInteractive={false} onFitView={fit}/>
}
export default function Graph({ graph, run, onSelect, selectedId }: any) {
  const colorMode = useColorMode()
  const { nodes, edges, bounds } = useMemo(() => {
    if (!graph) return { nodes: [], edges: [], bounds: { x: 0, y: 0, width: 1, height: 1 } }
    const layout = new dagre.graphlib.Graph().setGraph({ rankdir: 'TB', nodesep: 34, ranksep: 84, marginx: 24, marginy: 30 }).setDefaultEdgeLabel(() => ({}))
    for (const node of graph.nodes) layout.setNode(node.id, { width: 212, height: 66 })
    for (const edge of graph.edges) if (edge.source !== edge.target) layout.setEdge(edge.source, edge.target)
    // Join the static parallel lanes before the next top-level step.
    for (const node of graph.nodes.filter((n: any) => n.parent)) for (const edge of graph.edges.filter((e: any) => e.source === node.parent && e.kind === 'route')) layout.setEdge(node.id, edge.target)
    dagre.layout(layout)
    const nodes = graph.nodes.map((node: any) => {
      const occurrences = run?.occurrences.filter((o: any) => o.nodeId === (node.logicalId ?? node.id)) ?? []
      const point = layout.node(node.id)
      return { id: node.id, type: 'takt', selected: node.id === selectedId, position: { x: point.x - 106, y: point.y - 33 }, data: { ...node, status: occurrences.at(-1)?.status ?? (node.id === 'COMPLETE' && run?.status === 'completed' ? 'completed' : undefined), visits: occurrences.length } }
    })
    const loopLanes = new Map<string, number>()
    let left = Math.min(...nodes.map((n: any) => n.position.x)), top = Math.min(...nodes.map((n: any) => n.position.y))
    let right = Math.max(...nodes.map((n: any) => n.position.x + 212)), bottom = Math.max(...nodes.map((n: any) => n.position.y + 66))
    const edges = graph.edges.map((edge: any) => {
      const loop = edge.source === edge.target, lane = loopLanes.get(edge.source) ?? 0
      if (loop) {
        loopLanes.set(edge.source, lane + 1)
        const node = nodes.find((n: any) => n.id === edge.source)
        right = Math.max(right, node.position.x + 106 + loopOffset(lane) + 70)
        top = Math.min(top, node.position.y - 32); bottom = Math.max(bottom, node.position.y + 98)
      }
      return { id: edge.id, source: edge.source, target: edge.target, label: edge.label, type: loop ? 'loop' : 'smoothstep', data: { lane }, animated: run?.activeNodes.includes(edge.target), markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: 'var(--muted)' }, style: { stroke: run?.routes.some((r: any) => r.nodeId === (edge.logicalSource ?? edge.source) && r.target === edge.target) ? 'var(--accent)' : 'var(--muted)', strokeWidth: 1.5 }, labelStyle: { fill: 'var(--muted)', fontSize: 11 }, labelBgStyle: { fill: 'var(--surface)' }, labelBgPadding: [5, 4] as [number, number] }
    })
    return { nodes, edges, bounds: { x: left, y: top, width: right - left, height: bottom - top } }
  }, [graph, run, selectedId])
  return <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodeClick={(_, node) => onSelect(node.id)} minZoom={.25} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} colorMode={colorMode}><FitGraph bounds={bounds}/></ReactFlow>
}
