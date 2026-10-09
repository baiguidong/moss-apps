// Latest state is persisted independently of the bounded event feed. Definition
// v3 limits node executions; terminal instance entries are compact metadata only.
export function updateRunSnapshot(run: any, event: any) {
  if (event.workflowDepth > 0) return
  const snapshot = run.stateSnapshot ??= { nodes: {}, edges: {}, values: {}, sequence: 0 }
  snapshot.values ??= {}
  snapshot.sequence = (run.sequence || 0) + 1
  if (event.type === 'workflow_node') {
    const key = `${event.parentInstanceId || ''}/${event.instanceId}`
    const { input, output, ...metadata } = event
    if (input !== undefined || output !== undefined) snapshot.values[event.nodeId] = { input, output }
    snapshot.nodes[key] = { ...metadata, error: event.error?.slice(0, 2000), eventSequence: snapshot.sequence }
  } else if (event.type === 'workflow_edge') {
    const previous = snapshot.edges[event.edgeId]
    snapshot.edges[event.edgeId] = { ...event, sequence: snapshot.sequence,
      traversed: previous?.traversed || event.state === 'traversed' || event.state === 'selected' }
  }
}

export function readRunSnapshot(run: any) {
  if (!run.stateSnapshot) for (const event of run.events || []) updateRunSnapshot(run, event)
  const snapshot = run.stateSnapshot || { nodes: {}, edges: {}, sequence: run.sequence || 0 }
  const groups = new Map<string, any[]>()
  for (const event of Object.values(snapshot.nodes) as any[]) {
    const group = groups.get(event.nodeId) || []
    group.push(event); groups.set(event.nodeId, group)
  }
  const rank = (state: string) => ['running','waiting_children','queued','ready','blocked','failed','interrupted','cancelled','completed','skipped'].indexOf(state)
  return { sequence: run.sequence || 0,
    nodes: [...groups.values()].map(events => {
      const latest = events.reduce((a, b) => a.eventSequence > b.eventSequence ? a : b)
      const state = events.map(e => e.state).sort((a,b) => rank(a)-rank(b))[0]
      return { ...latest, ...snapshot.values?.[latest.nodeId], state: run.status === 'running' || !['running','waiting_children','queued','ready'].includes(state) ? state : run.status,
        executionCount: events.length }
    }),
    edges: Object.values(snapshot.edges).map((event: any) => ({ ...event, state: event.traversed ? 'traversed' : event.state })),
  }
}
