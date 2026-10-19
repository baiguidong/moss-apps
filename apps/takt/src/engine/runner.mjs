import { randomUUID } from 'node:crypto'
import { buildWrappedSystemPrompt } from '@takt/prompt'

let callHost
export function setHostCaller(caller) { callHost = caller }
const textSchema = { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false }
const provider = {
  supportsStructuredOutput: true,
  supportsIsolatedStructuredExecution: true,
  supportsNativeImageInput: false,
  supportsPermissionControls: () => false,
  keepsAllowedToolWithoutEdit: () => false,
  getDefaultAllowedToolsWithoutEdit: () => [],
  getRuntimeInstructions: () => null,
  setup: ({ name, systemPrompt }) => ({ call: (prompt, options) => execute(name, systemPrompt, prompt, options) }),
  setupIsolatedStructured: ({ name, systemPrompt }) => ({ call: (prompt, options) => execute(name, systemPrompt, prompt, options) }),
}
export function getProvider(type) {
  if (type !== 'moss') throw new Error(`本 App 只支持 Moss 执行，收到 provider: ${type}`)
  return provider
}
async function execute(name, systemPrompt, task, options) {
  if (!callHost) throw new Error('Moss execution adapter is not initialized')
  options.abortSignal?.throwIfAborted()
  if (options.model || options.resolvedModel || options.resolvedExecution?.model || options.mcpServers && Object.keys(options.mcpServers).length || options.bypassPermissions) throw new Error('不支持覆盖 Moss 的模型、MCP 或权限')
  const schema = options.outputSchema ?? textSchema
  const sessionId = options.sessionId ?? randomUUID()
  const prompt = [
    '这是 Moss 中的 TAKT 工作流步骤。使用当前 Moss 会话的工作区、模型和权限。以中文完成任务（除非任务明确要求其他语言）。',
    systemPrompt && `角色与约束：\n${systemPrompt}`,
    `步骤任务：\n${task}`,
    !options.outputSchema && '将本步骤的完整文字结果放入结果的 content 字段，保留任务要求的状态标记和换行。',
    '通过 Moss 提供的 StructuredOutput 输出工具提交最终结果，严格使用该工具声明的参数结构。步骤中的“不调用工具”仅限制业务操作，不限制这个结果输出工具。不要用普通文字或自行拼接的 JSON 替代该工具调用。',
  ].filter(Boolean).join('\n\n')
  if (prompt.length > 100_000) throw new Error('步骤输入超出 Moss 的 100000 字符限制，请缩短任务或拆分流程')
  const tools = options.executionPhase >= 2 || options.internalAgentIsolation ? [] : options.allowedTools
  const result = await callHost({ prompt, outputSchema: schema, contextKey: sessionId, ...(tools === undefined ? {} : { resources: { tools } }), step: options.workflowMeta?.currentStep ?? name, phase: options.executionPhase ?? 1, role: name }, options.abortSignal)
  options.abortSignal?.throwIfAborted()
  const content = options.outputSchema ? JSON.stringify(result.value) : result.value?.content
  if (typeof content !== 'string') throw new Error('Moss 返回的步骤结果格式无效')
  return { persona: name, status: 'done', content, timestamp: new Date(), sessionId, ...(options.outputSchema ? { structuredOutput: result.value } : {}), providerUsage: { totalTokens: result.tokens ?? 0, usageMissing: false } }
}
export async function runAgent(persona, task, options) {
  getProvider(options.resolvedExecution?.provider ?? options.resolvedProvider ?? options.provider)
  if (options.personaPath) throw new Error('首版只支持内联 persona')
  const definition = [persona, options.internalSystemPrompt].filter(Boolean).join('\n\n')
  const systemPrompt = buildWrappedSystemPrompt(definition, { ...options, providerRuntimeInstructions: null })
  options.onPromptResolved?.({ systemPrompt, userInstruction: task })
  options.onDispatch?.(undefined)
  return execute(options.internalAgentName ?? options.workflowMeta?.currentStep ?? 'agent', systemPrompt, task, options)
}
export class AgentRunner { run(persona, task, options) { return runAgent(persona, task, options) } }
