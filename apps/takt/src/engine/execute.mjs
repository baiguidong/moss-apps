import { WorkflowEngine } from '@takt/engine'
import { setHostCaller } from './runner.mjs'
import { parseDefinition } from './definition.mjs'

export async function executeWorkflow({ yaml, task, directory, workspace, callHost, onEvent, signal, onReady }) {
  const { config } = parseDefinition(yaml)
  const emit = (type, data = {}) => onEvent({ type, timestamp: Date.now(), ...data })
  const engine = new WorkflowEngine(config, workspace || directory, task, { provider: 'moss', language: 'en', projectCwd: workspace || directory, runPathsDirectory: directory, reportDirName: 'engine', abortSignal: signal, companionEnabled: false, interactive: false })
  onReady?.(engine)
  const active = new Map(), visits = new Map()
  let lastTopLevel
  const keyOf = step => step.personaDisplayName || step.name
  const ensure = (step, iteration, instruction) => {
    const nodeId = keyOf(step)
    if (!active.has(nodeId)) {
      const visit = (visits.get(nodeId) ?? 0) + 1; visits.set(nodeId, visit)
      const occurrenceId = `${nodeId}:${visit}`; active.set(nodeId, { occurrenceId, iteration, visit })
      emit('node.start', { nodeId, occurrenceId, iteration, visit, instruction })
    }
    return { nodeId, ...active.get(nodeId) }
  }
  setHostCaller(async (input, abortSignal) => {
    const current = [...active.entries()].find(([nodeId]) => nodeId === input.step || nodeId.endsWith('/' + input.step))
    return callHost({ ...input, nodeId: current?.[0], occurrenceId: current?.[1].occurrenceId }, abortSignal)
  })
  engine.on('step:start', (step, iteration, instruction) => {
    if (lastTopLevel) emit('route', { ...lastTopLevel, target: step.name })
    lastTopLevel = undefined
    ensure(step, iteration, instruction)
  })
  engine.on('phase:start', (step, phase, phaseName, instruction, _parts, phaseExecutionId, iteration) => emit('phase.start', { ...ensure(step, iteration, instruction), phase, phaseName, phaseExecutionId, instruction }))
  engine.on('phase:complete', (step, phase, phaseName, content, status, error, phaseExecutionId) => emit('phase.complete', { nodeId: keyOf(step), ...active.get(keyOf(step)), phase, phaseName, phaseExecutionId, content, status, error }))
  engine.on('step:complete', (step, response) => {
    for (const child of step.parallel ?? []) {
      const nodeId = keyOf(child), output = engine.getState().stepOutputs.get(child.name)
      if (output && active.has(nodeId)) { emit('node.complete', { nodeId, ...active.get(nodeId), content: output.content, status: output.status, error: output.error }); active.delete(nodeId) }
    }
    lastTopLevel = { nodeId: keyOf(step), iteration: active.get(keyOf(step))?.iteration, ruleIndex: response.matchedRuleIndex }
    const nodeId = keyOf(step); emit('node.complete', { nodeId, ...active.get(nodeId), content: response.content, status: response.status, error: response.error }); active.delete(nodeId)
  })
  engine.on('step:blocked', (step, response) => emit('node.blocked', { nodeId: keyOf(step), ...active.get(keyOf(step)), error: response.error || response.content }))
  let outcome
  engine.on('workflow:complete', () => { if (lastTopLevel) emit('route', { ...lastTopLevel, target: 'COMPLETE' }); outcome = { status: 'completed' } })
  engine.on('workflow:abort', (_state, reason) => { outcome = { status: signal?.aborted ? 'cancelled' : 'failed', error: reason } })
  const abort = () => engine.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    await engine.run()
    return outcome ?? { status: signal?.aborted ? 'cancelled' : 'failed', error: '引擎没有返回完成状态' }
  } finally { signal?.removeEventListener('abort', abort) }
}
