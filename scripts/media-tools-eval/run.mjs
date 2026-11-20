// Live, offline-scored routing evaluation. Only simulated tool results are returned to the model.
// node scripts/media-tools-eval/run.mjs --moss-text > results.json
// Or set EVAL_BASE_URL, EVAL_API_KEY and EVAL_MODEL for an OpenAI-compatible chat endpoint.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import Ajv from 'ajv'
import { appToolName } from '../../vendor/moss-core/packages/app-runtime/src/contributions/index.mjs'
import { avatar, avatarData, cases as initialCases, project, projectData, task, taskData } from './cases.mjs'
import { clarify, followupCases } from './followup.mjs'

const { values: options } = parseArgs({ options: {
  'app-dir': { type: 'string' }, 'moss-text': { type: 'boolean' }, 'retry-errors': { type: 'string' },
  followup: { type: 'boolean' }, verify: { type: 'boolean' },
} })
const app = options['app-dir'] || fileURLToPath(new URL('../../apps/media-tools/', import.meta.url))
const manifest = JSON.parse(await fs.readFile(path.join(app, 'app.moss.json')))
const candidate = {
  media_edit: 'process_media_file', media_transcribe: 'transcribe_media_file',
  video_project_save: 'save_video_project', video_render: 'render_video_project',
  media_get: 'query_workshop', media_cancel: 'cancel_task', media_export: 'export_task_file',
}
const descriptors = await Promise.all(manifest.contributes.tools.map(async t => ({
  id: t.id, description: t.description, schema: JSON.parse(await fs.readFile(path.join(app, t.inputSchema))),
})))
const ajv = new Ajv({ strict: false })
const validators = new Map(descriptors.map(t => [t.id, ajv.compile(t.schema)]))
function definitions(arm) {
  const byName = new Map()
  const tools = descriptors.map(original => {
    const t = arm === 'clarified' ? clarify(structuredClone(original)) : original
    const name = appToolName(manifest.id, arm === 'renamed' ? candidate[t.id] : t.id)
    byName.set(name, t.id)
    return { type: 'function', function: { name, description: t.description, parameters: t.schema } }
  })
  return { byName, tools }
}
const comparison = options.verify ? null : options.followup ? 'clarified' : 'renamed'
const cases = options.verify
  ? [...new Map([...initialCases, ...followupCases].map(scenario => [scenario.id, scenario])).values()]
  : options.followup ? followupCases : initialCases
const arms = { current: definitions('current') }
if (comparison) arms[comparison] = definitions(comparison)
const system = '你在 Moss 的音视频工坊中协助用户。根据请求使用可用工具，需要用户补充信息时说明；用中文回答。'

let endpoint = process.env.EVAL_BASE_URL, key = process.env.EVAL_API_KEY, model = process.env.EVAL_MODEL
if (options['moss-text']) {
  const config = JSON.parse(await fs.readFile(path.join(os.homedir(), '.moss/settings.json')))
  endpoint = config.models.text.baseUrl
  key = config.models.text.apiKey
  model = config.models.text.model
}
if (!endpoint || !key || !model) throw new Error('Set EVAL_BASE_URL, EVAL_API_KEY and EVAL_MODEL or use --moss-text')
const url = new URL(endpoint.replace(/\/$/, '') + '/chat/completions')
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for remote model calls')
async function completion(messages, tools) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response
    try {
      response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', stream: false }) })
    } catch (error) {
      if (attempt === 2) throw error
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)))
      continue
    }
    if (response.ok) {
      const data = await response.json()
      if (!data.choices?.[0]?.message) throw new Error('Provider returned no message')
      return { message: data.choices[0].message, servedModel: data.model }
    }
    if (![429, 502, 503, 504].includes(response.status) || attempt === 2) throw new Error('Model endpoint returned HTTP ' + response.status)
    await response.body?.cancel()
    await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)))
  }
}

function contains(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((v, i) => contains(actual[i], v))
  if (expected && typeof expected === 'object') return actual && typeof actual === 'object' && Object.entries(expected).every(([k, v]) => contains(actual[k], v))
  return actual === expected
}
function matches(call, step) {
  if (!step || call.id !== step[0] || !validators.get(call.id)?.(call.args) || !contains(call.args, step[1])) return false
  if (call.id === 'video_render') {
    if (call.args.output === 'speech' && (call.args.id === project || step[1].output !== 'speech')) return false
    if (call.args.id === avatar && ('fps' in call.args || 'quality' in call.args)) return false
  }
  if (call.id === 'video_project_save') {
    const keys = ['fields', 'animation', 'storyboard', 'sceneId', 'html']
    if (keys.some(k => (k in call.args) !== (k in step[1]))) return false
    if (('id' in call.args) !== ('id' in step[1]) || ('version' in call.args) !== ('version' in step[1])) return false
    if (call.args.id && call.args.kind && call.args.kind !== (call.args.id === avatar ? 'avatar' : 'animation')) return false
    if (call.args.id === avatar && call.args.fields) {
      for (const [key, value] of Object.entries(call.args.fields)) {
        if (value !== (step[1].fields[key] ?? avatarData[key])) return false
      }
    }
  }
  return true
}
function observedResult(call, scenario) {
  if (call.id === 'media_transcribe') return { id: task, status: 'queued', artifacts: [] }
  if (call.id === 'media_get') {
    if (call.args.type === 'task') return scenario.id === 'cancel' ? { id: task, status: 'running', artifacts: [] } : taskData
    if (call.args.type === 'project') return call.args.id === avatar ? avatarData : projectData
    if (call.args.type === 'settings') return { voices: ['Tingting'], avatars: [{ id: 'moss', name: '小墨' }], projects: [], aspects: ['16:9','9:16'], qualities: ['720p','480p'] }
  }
  throw new Error('The fixture has no continuation for ' + call.id)
}
function relevantRead(call, scenario) {
  if (call.id !== 'media_get' || !validators.get(call.id)(call.args)) return false
  if (scenario.optionalReads?.some(step => matches(call, step))) return true
  if (call.args.type === 'project' && [project, avatar].includes(call.args.id) && scenario.prompt.includes(call.args.id)) return true
  return call.args.type === 'task' && call.args.id === task && scenario.prompt.includes(task)
}
function appropriateReply(id, text) {
  if (!text?.trim()) return false
  if (id === 'missing-file') return /上传|发送|提供|发给|文件路径|绝对路径/.test(text)
  if (id === 'speech-on-animation') return /口播/.test(text) && /无法|不能|不支持|仅|只|限于|不适用|不提供/.test(text)
  if (id === 'engine-version') return /无法|不能|没有|不提供|查不到|未提供|未暴露|不支持|没法|不包含/.test(text) && !/(?:FFmpeg|ffprobe)\s*(?:版本)?\s*[:：v]?\s*\d+\.\d+/i.test(text)
  if (id === 'import-only') return /导入|素材/.test(text) && /页面|界面|手动|无法|不能|不支持|没有|未提供|不提供/.test(text)
  return false
}
async function run(scenario, arm) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: scenario.prompt }]
  const result = { case: scenario.id, arm, group: scenario.group || 'routing', turns: [], first: false, passed: false }
  const { byName, tools } = arms[arm]
  let index = 0
  for (let turn = 0; turn < 5; turn++) {
    const { message, servedModel } = await completion(messages, tools)
    result.servedModel = servedModel
    const calls = (message.tool_calls || []).map(c => {
      let args
      try { args = JSON.parse(c.function.arguments) } catch { args = null }
      return { id: byName.get(c.function.name) || c.function.name, name: c.function.name, args }
    })
    if (!calls.length) {
      const answer = typeof message.content === 'string' ? message.content : ''
      result.turns.push({ answer })
      result.passed = !scenario.steps.length && appropriateReply(scenario.replyCriterion || scenario.id, answer)
      if (!turn) result.first = result.passed
      return result
    }
    result.turns.push({ calls })
    // None of these requests requires two independent actions in the same turn.
    // For dependent calls, values must come from a tool result in an earlier turn.
    if (calls.length !== 1) return result
    const call = calls[0], matched = matches(call, scenario.steps[index])
    if (!turn) result.first = Boolean(matched || (!scenario.steps.length && relevantRead(call, scenario)))
    if (matched) index++
    else if (!relevantRead(call, scenario)) return result
    if (scenario.steps.length && index === scenario.steps.length) {
      result.passed = true
      return result
    }
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls },
      { role: 'tool', tool_call_id: message.tool_calls[0].id, content: JSON.stringify(observedResult(call, scenario)) })
  }
  return result
}

const all = cases.flatMap((scenario, index) => {
  const names = Object.keys(arms)
  if (index % 2) names.reverse()
  return names.map(arm => [scenario, arm])
})
const manifestToolsHash = createHash('sha256').update(JSON.stringify(arms.current.tools)).digest('hex')
const comparisonToolsHash = comparison && createHash('sha256').update(JSON.stringify(arms[comparison].tools)).digest('hex')
const candidateNames = options.verify ? undefined : candidate
const previous = new Map()
if (options['retry-errors']) {
  const run = JSON.parse(await fs.readFile(options['retry-errors'], 'utf8'))
  if (run.model !== model || run.system !== system || run.manifestToolsHash !== manifestToolsHash || run.comparisonToolsHash !== comparisonToolsHash ||
      JSON.stringify(run.cases) !== JSON.stringify(cases) || JSON.stringify(run.candidate) !== JSON.stringify(candidateNames)) {
    throw new Error('Prior results use a different model, cases, prompt or tool definitions')
  }
  for (const row of run.results) if (!row.error) previous.set(row.arm + '/' + row.case, row)
}
const results = new Array(all.length)
let next = 0
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < all.length) {
    const n = next++, [c, arm] = all[n]
    const completed = previous.get(arm + '/' + c.id)
    if (completed) { results[n] = completed; continue }
    try { results[n] = await run(c, arm) }
    catch (err) { results[n] = { case: c.id, arm, group: c.group || 'routing', error: err.message } }
    console.error(arm, c.id, results[n].error || (results[n].passed ? 'PASS' : 'FAIL'))
  }
}))
const totals = {}
for (const arm of Object.keys(arms)) for (const group of ['routing','coverage']) {
  const rows = results.filter(r => r.arm === arm && r.group === group)
  totals[arm + '/' + group] = { total: rows.length, errors: rows.filter(r => r.error).length, first: rows.filter(r => r.first).length, passed: rows.filter(r => r.passed).length }
}
console.log(JSON.stringify({ time: new Date().toISOString(), appVersion: manifest.version, model, system, candidate: candidateNames,
  manifestToolsHash, comparisonToolsHash, comparison,
  cases, totals, results }, null, 2))
if (results.some(r => r.error || (options.verify && !r.passed))) process.exitCode = 1
