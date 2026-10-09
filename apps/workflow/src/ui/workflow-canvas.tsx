"use client";

import * as React from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  useNodesInitialized,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  WorkflowEdgeEvent,
  WorkflowGraph,
  WorkflowNodeEvent,
} from "./types";

type CanvasStatus = "unvisited" | "running" | "completed" | "blocked" | "skipped" | "stopped" | "error";
type WorkflowNodeType = WorkflowGraph["nodes"][number]["type"];
type WorkflowCanvasNodeData = Record<string, unknown> & {
  nodeType: WorkflowNodeType;
  nodeTypeLabel: string;
  title: string;
  runtimeText?: string;
  branchCount?: number;
  status: CanvasStatus;
};
type WorkflowCanvasNode = Node<WorkflowCanvasNodeData, "workflow-node">;

const NODE_WIDTH = 220;
const NODE_HEIGHT = 84;
const LOOP_EDGE_TYPE = "workflow-loop-back";

export const WORKFLOW_NODE_TYPE_LABELS: Record<WorkflowNodeType | "foreach", string> = {
  start: "输入",
  end: "输出",
  agent: "Agent",
  code: "代码",
  condition: "判断",
  workflow: "子流程",
  merge: "汇合",
  parallel: "并行",
  join: "并行汇合",
  foreach: "遍历",
};

const WORKFLOW_NODE_LEGEND: Array<{ type: WorkflowNodeType | "foreach"; label: string }> = (
  Object.entries(WORKFLOW_NODE_TYPE_LABELS) as Array<[WorkflowNodeType | "foreach", string]>
).map(([type, label]) => ({ type, label }));

const NODE_STYLE: Record<CanvasStatus, React.CSSProperties> = {
  unvisited: { background: "var(--muted)", borderColor: "#a1a1aa", color: "var(--muted-foreground)" },
  running: { background: "#fef3c7", borderColor: "#f59e0b", color: "#78350f", boxShadow: "0 0 0 2px rgb(245 158 11 / 24%)" },
  completed: { background: "#dcfce7", borderColor: "#22c55e", color: "#14532d" },
  blocked: { background: "#ffedd5", borderColor: "#f97316", color: "#9a3412", boxShadow: "0 0 0 2px rgb(249 115 22 / 20%)" },
  skipped: { background: "#f4f4f5", borderColor: "#d4d4d8", color: "#71717a", opacity: 0.68 },
  stopped: { background: "#fef3c7", borderColor: "#d97706", color: "#78350f" },
  error: { background: "#fee2e2", borderColor: "#ef4444", color: "#7f1d1d", boxShadow: "0 0 0 2px rgb(239 68 68 / 20%)" },
};

function WorkflowNodeShape({
  type,
  status,
}: {
  type: WorkflowNodeType | "foreach";
  status: CanvasStatus;
}) {
  const style = NODE_STYLE[status];
  const fill = String(style.background);
  const stroke = String(style.borderColor);
  const strokeWidth = status === "running" || status === "error" ? 2.5 : 1.5;
  const common = { fill, stroke, strokeWidth, vectorEffect: "non-scaling-stroke" as const };

  return (
    <svg viewBox="0 0 220 84" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
      {type === "start" ? <rect x="1" y="1" width="218" height="82" rx="41" {...common} /> : null}
      {type === "end" ? (
        <>
          <polygon points="22,1 198,1 219,22 219,62 198,83 22,83 1,62 1,22" {...common} />
          <polygon points="25,6 195,6 214,25 214,59 195,78 25,78 6,59 6,25" fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
      {type === "agent" ? <rect x="1" y="1" width="218" height="82" rx="12" {...common} /> : null}
      {type === "code" ? (
        <>
          <rect x="1" y="1" width="218" height="82" rx="3" {...common} />
          <path d="M 10 1 V 83 M 210 1 V 83" fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
      {type === "condition" ? <polygon points="110,1 219,42 110,83 1,42" {...common} /> : null}
      {type === "parallel" ? <polygon points="20,1 200,1 219,42 200,83 20,83 1,42" {...common} /> : null}
      {type === "join" ? <polygon points="1,1 219,1 188,83 32,83" {...common} /> : null}
      {type === "merge" ? <polygon points="32,1 188,1 219,83 1,83" {...common} /> : null}
      {type === "workflow" ? (
        <>
          <rect x="7" y="1" width="212" height="76" rx="10" {...common} />
          <rect x="1" y="7" width="212" height="76" rx="10" fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
      {type === "foreach" ? (
        <>
          <path d="M 1 13 C 1 -2 219 -2 219 13 V 71 C 219 86 1 86 1 71 Z" {...common} />
          <path d="M 1 13 C 1 28 219 28 219 13" fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
    </svg>
  );
}

function WorkflowCanvasNodeCard({ data, selected }: NodeProps<WorkflowCanvasNode>) {
  const style = NODE_STYLE[data.status];
  const showTitle = data.title.trim().toLocaleLowerCase() !== data.nodeTypeLabel.toLocaleLowerCase();
  return (
    <div
      className="relative flex h-[84px] w-[220px] items-center justify-center px-8 text-center text-xs font-semibold leading-[1.35]"
      style={{
        color: style.color,
        opacity: style.opacity,
        filter: selected ? "drop-shadow(0 0 4px rgb(59 130 246 / 55%))" : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-zinc-500" />
      <WorkflowNodeShape type={data.nodeType} status={data.status} />
      <div className="relative z-[1] flex min-w-0 flex-col items-center gap-1">
        <div className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium opacity-70">
          <span>{data.nodeTypeLabel}</span>
          {data.branchCount !== undefined ? <span>· {data.branchCount} 路</span> : null}
        </div>
        {showTitle ? <div className="max-w-[150px] whitespace-pre-line break-words">{data.title}</div> : null}
        {data.runtimeText ? <div className="text-[10px] font-medium opacity-75">{data.runtimeText}</div> : null}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-zinc-500" />
    </div>
  );
}

const NODE_TYPES = { "workflow-node": WorkflowCanvasNodeCard };

function WorkflowNodeLegend() {
  return (
    <Panel position="top-right" className="pointer-events-none">
      <div className="pointer-events-auto flex max-h-[calc(100vh-12rem)] w-28 flex-col gap-1 overflow-y-auto rounded-lg border border-border/70 bg-background/90 p-2 shadow-sm backdrop-blur">
        <div className="mb-0.5 text-[10px] font-semibold text-foreground">节点类型</div>
        {WORKFLOW_NODE_LEGEND.map((item) => (
          <div key={item.type} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[9px] text-muted-foreground">
            <span className="relative block h-4 w-8 shrink-0">
              <WorkflowNodeShape type={item.type} status="unvisited" />
            </span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function statusByWorkflowNode(events: WorkflowNodeEvent[]): Map<string, CanvasStatus> {
  const latestByInstance = new Map<string, WorkflowNodeEvent>();
  for (const event of events) latestByInstance.set(event.instanceId, event);
  const states = new Map<string, WorkflowNodeEvent["state"][]>();
  for (const event of latestByInstance.values()) {
    const rows = states.get(event.nodeId) ?? [];
    rows.push(event.state);
    states.set(event.nodeId, rows);
  }
  const result = new Map<string, CanvasStatus>();
  for (const [nodeId, values] of states) {
    result.set(nodeId,
      values.some(value => ["ready", "queued", "running", "waiting_children"].includes(value)) ? "running"
        : values.some(value => value === "blocked") ? "blocked"
          : values.some(value => value === "failed") ? "error"
          : values.some(value => value === "cancelled" || value === "interrupted") ? "stopped"
            : values.some(value => value === "completed") ? "completed"
              : values.some(value => value === "skipped") ? "skipped"
                : "unvisited",
    );
  }
  return result;
}

function latestEdgeEvents(events: WorkflowEdgeEvent[]): Map<string, WorkflowEdgeEvent> {
  const result = new Map<string, WorkflowEdgeEvent>();
  for (const event of events) {
    const prior = result.get(event.edgeId);
    if (!prior || event.sequence > prior.sequence) result.set(event.edgeId, event);
  }
  return result;
}

function executionCount(nodeEvents: WorkflowNodeEvent[], workflowNodeId: string): number {
  const snapshotCount = (nodeEvents.find(event => event.nodeId === workflowNodeId) as any)?.executionCount;
  if (snapshotCount !== undefined) return snapshotCount;
  return new Set(
    nodeEvents
      .filter(event => event.nodeId === workflowNodeId)
      .map(event => event.instanceId),
  ).size;
}

export function getWorkflowLoopBackPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  lane = 0,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  lane?: number;
}) {
  const sideX = Math.min(sourceX, targetX) - NODE_WIDTH / 2 - 48 - lane * 32;
  const sourceOuterY = sourceY + 26;
  const targetOuterY = targetY - 26;
  return {
    path: [
      `M ${sourceX} ${sourceY}`,
      `L ${sourceX} ${sourceOuterY}`,
      `L ${sideX} ${sourceOuterY}`,
      `L ${sideX} ${targetOuterY}`,
      `L ${targetX} ${targetOuterY}`,
      `L ${targetX} ${targetY}`,
    ].join(" "),
    labelX: sideX,
    labelY: (sourceOuterY + targetOuterY) / 2,
  };
}

function WorkflowLoopBackEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  label,
  data,
}: EdgeProps) {
  const lane = typeof data?.lane === "number" ? data.lane : 0;
  const { path, labelX, labelY } = getWorkflowLoopBackPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    lane,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label != null && String(label).trim() !== "" ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded-md border border-border/60 bg-background/95 px-1.5 py-0.5 text-[11px] font-semibold text-foreground shadow-sm"
            style={{
              transform: `translate(8px, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const EDGE_TYPES = { [LOOP_EDGE_TYPE]: WorkflowLoopBackEdge };

function nodeRuntimeText(graph: WorkflowGraph, nodeId: string, events: WorkflowNodeEvent[]): string | undefined {
  const node = graph.nodes.find(candidate => candidate.id === nodeId);
  if (!node) return undefined;
  const latest = events
    .filter(event => event.nodeId === node.workflowNodeId)
    .sort((left, right) => right.sequence - left.sequence)[0];
  const count = executionCount(events, node.workflowNodeId);
  const running = latest && ["ready", "queued", "running", "waiting_children"].includes(latest.state);
  const suffix = running
    ? count > 1 ? `第 ${count} 次运行中` : "运行中"
    : count > 1 ? `已执行 ${count} 次` : undefined;
  if (node.type === "condition" && latest?.branch) {
    const edge = graph.edges.find(candidate => candidate.source === node.id && candidate.branchKey === latest.branch);
    return `结果：${edge?.label ?? latest.branch}${suffix ? ` · ${suffix}` : ""}`;
  }
  return suffix;
}

export function buildWorkflowCanvasElements(graph: WorkflowGraph, nodeEvents: WorkflowNodeEvent[], edgeEvents: WorkflowEdgeEvent[]) {
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: "TB", ranksep: 92, nodesep: 52, marginx: 40, marginy: 40 });
  for (const node of graph.nodes) layout.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of graph.edges) {
    if (edge.type !== "loop-back") layout.setEdge(edge.source, edge.target);
  }
  dagre.layout(layout);

  const statuses = statusByWorkflowNode(nodeEvents);
  const edgeStates = latestEdgeEvents(edgeEvents);
  const nodes: WorkflowCanvasNode[] = graph.nodes.map(node => {
    const point = layout.node(node.id) ?? { x: 0, y: 0 };
    const status = statuses.get(node.workflowNodeId) ?? "unvisited";
    const branchCount = node.type === "condition" || node.type === "parallel"
      ? graph.edges.filter(edge => edge.source === node.id && edge.branchKey).length
      : undefined;
    const typeLabel = WORKFLOW_NODE_TYPE_LABELS[node.type];
    const runtimeText = nodeRuntimeText(graph, node.id, nodeEvents);
    return {
      id: node.id,
      type: "workflow-node",
      data: {
        nodeType: node.type,
        nodeTypeLabel: typeLabel,
        title: node.label,
        status,
        ...(runtimeText ? { runtimeText } : {}),
        ...(branchCount !== undefined ? { branchCount } : {}),
      },
      position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      selectable: true,
      draggable: false,
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
    };
  });
  let loopLane = 0;
  const resultEdges: Edge[] = graph.edges.map(edge => {
    const event = edge.workflowEdgeId ? edgeStates.get(edge.workflowEdgeId) : undefined;
    const source = graph.nodes.find(node => node.id === edge.source);
    const target = graph.nodes.find(node => node.id === edge.target);
    // Older persisted runs retain only the final condition decision. A loop
    // that was traversed and later skipped is still provable from a repeated
    // target instance, so keep the completed loop visible on replay.
    const repeatedLoopTarget = edge.type === "loop-back"
      && target != null
      && executionCount(nodeEvents, target.workflowNodeId) > 1;
    const enteredForeachBody = source?.type === "foreach"
      && edge.branchKey === "item"
      && target != null
      && statuses.get(target.workflowNodeId) !== undefined;
    const used = event?.state === "selected" || event?.state === "traversed" || repeatedLoopTarget || enteredForeachBody;
    const active = used && graph.nodes.some(node => node.id === edge.target && statuses.get(node.workflowNodeId) === "running");
    const skipped = event?.state === "skipped" && !repeatedLoopTarget;
    const lane = edge.type === "loop-back" ? loopLane++ : undefined;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: edge.type === "loop-back" ? LOOP_EDGE_TYPE : "default",
      ...(lane !== undefined ? { data: { lane } } : {}),
      zIndex: edge.type === "loop-back" ? 10 : 0,
      animated: active,
      markerEnd: { type: MarkerType.ArrowClosed, color: used ? "#22c55e" : skipped ? "#a1a1aa" : "#71717a" },
      style: {
        stroke: used ? "#22c55e" : skipped ? "#a1a1aa" : "#71717a",
        strokeWidth: used ? 2.5 : 1.5,
        opacity: skipped ? 0.32 : 1,
        strokeDasharray: edge.type === "loop-back" ? "7 5" : undefined,
      },
      labelStyle: { fill: "currentColor", fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: "var(--background)", fillOpacity: 0.92 },
      labelBgPadding: [5, 3] as [number, number],
      labelBgBorderRadius: 5,
    };
  });
  return { nodes, edges: resultEdges };
}

function InitialViewport({ compact, nodeIds }: {compact:boolean;nodeIds:string[]}) {
  const ready = useNodesInitialized(), { fitView } = useReactFlow();
  const key = nodeIds.join(',');
  React.useEffect(() => {
    if (!compact || !ready) return;
    void fitView({ nodes: nodeIds.slice(0,3).map(id => ({id})), padding:0.15, minZoom:0.65, maxZoom:1 });
  }, [compact, ready, key, fitView]);
  return null;
}

export function WorkflowCanvas({
  graph,
  nodeEvents,
  edgeEvents,
  onNodeClick,
  compact = false,
}: {
  compact?: boolean;
  graph: WorkflowGraph;
  nodeEvents: WorkflowNodeEvent[];
  edgeEvents: WorkflowEdgeEvent[];
  onNodeClick: (nodeId: string) => void;
}) {
  const elements = React.useMemo(
    () => buildWorkflowCanvasElements(graph, nodeEvents, edgeEvents),
    [graph, nodeEvents, edgeEvents],
  );

  return (
    <ReactFlow
      nodes={elements.nodes}
      edges={elements.edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodeClick={(_event, node) => onNodeClick(node.id)}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesReconnectable={false}
      deleteKeyCode={null}
      minZoom={0.2}
      maxZoom={2.5}
      fitView={!compact}
      fitViewOptions={{ padding: 0.18, maxZoom: 1.2 }}
      proOptions={{ hideAttribution: true }}
      className="bg-background"
    >
      <InitialViewport compact={compact} nodeIds={elements.nodes.map(node => node.id)} />
      <Background gap={20} size={1} color="rgb(161 161 170 / 28%)" />
      <Controls showInteractive={false} position="bottom-left" />
      {!compact && <WorkflowNodeLegend />}
      {graph.nodes.length > 12 ? <MiniMap pannable zoomable position="bottom-right" /> : null}
    </ReactFlow>
  );
}
