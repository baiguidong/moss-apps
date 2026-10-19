import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { parseDefinition } from '../engine/definition.mjs'

export const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 })
  fs.renameSync(file + '.tmp', file)
}
export class Store {
  constructor(directory) {
    this.directory = directory
    this.catalog = new Map(); this.runs = new Map()
    for (const type of ['catalog', 'runs', 'resources']) fs.mkdirSync(path.join(directory, type), { recursive: true })
    for (const [type, map] of [['catalog', this.catalog], ['runs', this.runs]]) {
      for (const name of fs.readdirSync(path.join(directory, type)).filter(n => /^[a-z]+_[a-f0-9-]+\.json$/.test(n))) {
        const value = JSON.parse(fs.readFileSync(path.join(directory, type, name), 'utf8')); map.set(value.id, value)
      }
    }
  }
  saveRun(run) { this.runs.set(run.id, run); atomic(path.join(this.directory, 'runs', run.id + '.json'), run) }
  getRun(id) { const run = this.runs.get(id); if (!run) throw new Error('运行不存在'); return run }
  getWorkflow(id) { const workflow = this.catalog.get(id); if (!workflow) throw new Error('工作流不存在'); return workflow }
  revision(id, revision) {
    const record = this.getWorkflow(id)
    const item = record.revisions.find(r => r.revision === (revision ?? record.revision))
    if (!item) throw new Error('修订不存在')
    return { ...record, revisions: undefined, latestRevision: record.revision, ...item }
  }
  create(input) {
    const parsed = parseDefinition(input.yaml), id = 'flow_' + randomUUID(), now = Date.now()
    const record = { id, name: parsed.raw.name, title: input.title || parsed.raw.name, description: parsed.raw.description || '', revision: 1, createdAt: now, updatedAt: now, revisions: [{ revision: 1, yaml: input.yaml, graph: parsed.graph, engineVersion: parsed.engineVersion, savedAt: now }] }
    this.catalog.set(id, record); atomic(path.join(this.directory, 'catalog', id + '.json'), record)
    return this.revision(id)
  }
  edit(input) {
    const record = this.getWorkflow(input.workflowId)
    if (record.revision !== input.baseRevision) throw new Error(`修订冲突：当前为 ${record.revision}，请重新读取`)
    const parsed = parseDefinition(input.yaml), now = Date.now()
    record.revision++; record.updatedAt = now; record.name = parsed.raw.name; record.description = parsed.raw.description || ''
    if (input.title) record.title = input.title
    record.revisions.push({ revision: record.revision, yaml: input.yaml, graph: parsed.graph, engineVersion: parsed.engineVersion, savedAt: now })
    atomic(path.join(this.directory, 'catalog', record.id + '.json'), record)
    return this.revision(record.id)
  }
  revisions(input) {
    const record = this.getWorkflow(input.workflowId)
    return { items: [...record.revisions].reverse().map(({ revision, savedAt, engineVersion }) => ({ revision, savedAt, engineVersion })), latestRevision: record.revision }
  }
  archive(input) {
    const record = this.getWorkflow(input.workflowId)
    record.archived = input.archived; record.updatedAt = Date.now()
    atomic(path.join(this.directory, 'catalog', record.id + '.json'), record)
    return { id: record.id, archived: record.archived }
  }
  list(input = {}) {
    const items = [...(input.kind === 'runs' ? this.runs : this.catalog).values()].filter(r => (input.includeArchived || !r.archived) && (!input.workflowId || r.workflowId === input.workflowId) && (!input.status || r.status === input.status) && (!input.query || (r.title + r.name + r.description).toLowerCase().includes(input.query.toLowerCase()))).sort((a, b) => b.createdAt - a.createdAt)
    const offset = input.offset ?? 0, limit = Math.min(input.limit ?? 20, 50)
    return { items: items.slice(offset, offset + limit).map(r => input.kind === 'runs' ? this.summary(r) : { id: r.id, title: r.title, name: r.name, description: r.description, revision: r.revision, archived: !!r.archived, updatedAt: r.updatedAt }), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null }
  }
  summary(run) {
    return { id: run.id, workflowId: run.workflowId, revision: run.revision, title: run.title, task: run.task, status: run.status, createdAt: run.createdAt, endedAt: run.endedAt, error: run.error, taskId: run.taskId, sessionId: run.sessionId, workspace: run.workspace, sequence: run.sequence, completedSteps: run.occurrences.filter(n => n.status === 'completed').length, activeNodes: run.occurrences.filter(n => n.status === 'running').map(n => n.nodeId), tokens: Object.values(run.executions).reduce((sum, e) => sum + (e.tokens || 0), 0), toolCalls: Object.values(run.executions).reduce((sum, e) => sum + (e.toolCalls || 0), 0), route: '#/runs/' + run.id }
  }
  bound(text) {
    if (typeof text !== 'string' || text.length <= 6000) return text
    const resourceRef = digest(text), file = path.join(this.directory, 'resources', resourceRef + '.txt')
    if (!fs.existsSync(file)) fs.writeFileSync(file, text, { mode: 0o600 })
    return { preview: text.slice(0, 1500), resourceRef, length: text.length }
  }
  resource(input) {
    if (!/^[a-f0-9]{64}$/.test(input.resourceRef)) throw new Error('资源引用无效')
    const file = path.join(this.directory, 'resources', input.resourceRef + '.txt')
    const text = fs.readFileSync(file, 'utf8'), offset = input.offset ?? 0, end = offset + Math.min(input.limit ?? 20000, 40000)
    return { text: text.slice(offset, end), length: text.length, nextOffset: end < text.length ? end : null }
  }
  record(run, input) {
    const event = { ...input, sequence: ++run.sequence }
    for (const field of ['content', 'instruction']) if (event[field]) event[field] = this.bound(event[field])
    fs.appendFileSync(path.join(this.directory, 'runs', run.id + '.events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 })
    run.events.push(event); if (run.events.length > 100) run.events.shift()
    let occurrence = run.occurrences.find(n => n.id === event.occurrenceId)
    if (event.type === 'node.start' && !occurrence) { occurrence = { id: event.occurrenceId, nodeId: event.nodeId, visit: event.visit, iteration: event.iteration, status: 'running', startedAt: event.timestamp }; run.occurrences.push(occurrence) }
    if (occurrence) {
      if (event.type === 'phase.start') Object.assign(occurrence, { phase: event.phase, phaseName: event.phaseName, instruction: event.instruction })
      if (event.type === 'node.complete' || event.type === 'node.blocked') Object.assign(occurrence, { status: event.type === 'node.blocked' || event.status !== 'done' ? 'failed' : 'completed', content: event.content, error: event.error, endedAt: event.timestamp })
    }
    if (event.type === 'route') run.routes.push({ nodeId: event.nodeId, target: event.target, ruleIndex: event.ruleIndex, iteration: event.iteration })
    this.saveRun(run)
    return event
  }
  events(input) {
    const run = this.getRun(input.runId)
    const file = path.join(this.directory, 'runs', run.id + '.events.jsonl')
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
    const events = lines.filter(e => e.sequence > (input.afterSequence ?? 0)).slice(0, Math.min(input.limit ?? 50, 100))
    return { events, nextSequence: events.at(-1)?.sequence ?? input.afterSequence ?? 0, total: run.sequence }
  }
  detail(id) { const run = this.getRun(id); return { ...this.summary(run), yaml: run.yaml, graph: run.graph, occurrences: run.occurrences, executions: Object.values(run.executions).map(({ input, ...e }) => e), routes: run.routes, events: run.events.slice(-30) } }
}
