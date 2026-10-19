import { parseDocument } from 'yaml'
import { z } from 'zod'
import { parseWorkflowRuleCondition } from '@takt/rules'
import { validateWorkflowConfig } from '@takt/validator'

const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
const rule = z.object({ condition: z.string().min(1).max(1000), next: z.string().min(1).max(64) }).strict()
const stepBase = {
  name, description: z.string().max(300).optional(), persona: z.string().max(8000).optional(),
  instruction: z.string().min(1).max(20000).optional(), rules: z.array(rule).min(1).max(12),
  pass_previous_response: z.boolean().optional(), session: z.enum(['continue', 'refresh']).optional(),
}
const child = z.object(stepBase).strict().refine(s => !!s.instruction, 'Agent 步骤需要 instruction')
const step = z.object({ ...stepBase, parallel: z.array(child).min(2).max(4).optional(), concurrency: z.number().int().min(1).max(4).optional() }).strict().superRefine((s, ctx) => {
  if (!s.parallel && !s.instruction) ctx.addIssue({ code: 'custom', message: 'Agent 步骤需要 instruction' })
  if (s.parallel && (s.session || s.persona || s.instruction)) ctx.addIssue({ code: 'custom', message: '并行父节点只声明 parallel、rules 和 concurrency' })
  if (!s.parallel && s.concurrency) ctx.addIssue({ code: 'custom', message: 'concurrency 只适用于并行节点' })
})
export const definitionSchema = z.object({ name, description: z.string().max(500).optional(), initial_step: name.optional(), max_steps: z.number().int().min(1).max(64), steps: z.array(step).min(1).max(24) }).strict()

export function parseDefinition(yaml) {
  if (typeof yaml !== 'string' || yaml.length > 80000) throw new Error('定义必须是最多 80000 字符的 YAML')
  const document = parseDocument(yaml, { uniqueKeys: true })
  if (document.errors.length) throw new Error(document.errors.map(e => e.message).join('\n'))
  const raw = definitionSchema.parse(document.toJS({ maxAliasCount: 20 }))
  const normalize = (s, parent) => ({
    name: s.name, description: s.description, kind: 'agent', personaDisplayName: parent ? `${parent}/${s.name}` : s.name,
    persona: s.persona, instruction: s.instruction ?? '', sessionKey: parent ? `${parent}/${s.name}` : s.name,
    session: s.session, passPreviousResponse: s.pass_previous_response ?? true,
    rules: s.rules.map(r => ({ condition: parseWorkflowRuleCondition(r.condition), next: r.next })),
    ...(s.parallel ? { parallel: s.parallel.map(c => normalize(c, s.name)), concurrency: s.concurrency ?? s.parallel.length } : {}),
  })
  const config = { name: raw.name, description: raw.description, initialStep: raw.initial_step ?? raw.steps[0].name, maxSteps: raw.max_steps, steps: raw.steps.map(s => normalize(s)) }
  validateWorkflowConfig(config, { provider: 'moss' })
  const names = new Set(raw.steps.map(s => s.name))
  if (names.has('COMPLETE') || names.has('ABORT')) throw new Error('COMPLETE 和 ABORT 是保留节点名')
  for (const s of raw.steps) {
    for (const r of s.rules) if (!names.has(r.next) && !['COMPLETE', 'ABORT'].includes(r.next)) throw new Error(`未知目标节点：${r.next}`)
    for (const c of s.parallel ?? []) for (const r of c.rules) if (!['COMPLETE', 'ABORT'].includes(r.next)) throw new Error('并行子节点的 next 必须为 COMPLETE 或 ABORT')
  }
  return { raw, config, graph: graphOf(raw), engineVersion: '0.70.0' }
}
export function graphOf(raw) {
  const nodes = [], edges = []
  for (const s of raw.steps) {
    nodes.push({ id: s.name, title: s.description || s.name, kind: s.parallel ? 'parallel' : 'agent' })
    for (const c of s.parallel ?? []) {
      nodes.push({ id: `${s.name}/${c.name}`, title: c.description || c.name, kind: 'agent', parent: s.name })
      edges.push({ id: `${s.name}/${c.name}:fork`, source: s.name, target: `${s.name}/${c.name}`, label: '并行', kind: 'parallel' })
      edges.push({ id: `${s.name}/${c.name}:join`, source: `${s.name}/${c.name}`, target: `${s.name}:join`, label: '', kind: 'parallel' })
    }
    if (s.parallel) nodes.push({ id: `${s.name}:join`, title: '合并审查结果', kind: 'join', logicalId: s.name })
    s.rules.forEach((r, i) => edges.push({ id: `${s.name}:${i}`, source: s.parallel ? `${s.name}:join` : s.name, logicalSource: s.name, target: r.next, label: r.condition, kind: 'route' }))
  }
  for (const id of ['COMPLETE', 'ABORT']) if (edges.some(e => e.target === id)) nodes.push({ id, title: id === 'COMPLETE' ? '完成' : '终止', kind: 'terminal' })
  return { nodes, edges, entry: raw.initial_step ?? raw.steps[0].name }
}
