import { AppServiceError, defineAppBackend, type AgentHostRequestMap, type AppBackendContext } from '@moss/app-sdk'
import type { ChannelStatus } from '../contracts'
import { createRegistration } from './registration'
import { launchGateway, write, type GatewayEvent } from './gateway'

const agentProtocol = 'moss.agent/v1'
const registration = createRegistration()
let channel: Awaited<ReturnType<typeof launchGateway>> | undefined
let lifecycle: AbortController | undefined
let retry: ReturnType<typeof setTimeout> | undefined
let connectionError: string | undefined
let connected = false

function status(context: AppBackendContext): ChannelStatus {
  return {
    configured: Boolean(context.config.appId && context.secrets.appSecret),
    connected,
    error: connectionError,
    hasEncryptKey: Boolean(context.secrets.encryptKey),
    hasVerificationToken: Boolean(context.secrets.verificationToken),
  }
}

async function updateBinding(context: AppBackendContext) {
  const externalConversationId = '*'
  const current = await context.agent.request('binding.get', { externalConversationId })
  const agentId = typeof context.config.agentId === 'string' ? context.config.agentId : null
  const bindingTools = current.binding?.policy.resources?.tools
  // Explicit App settings supersede legacy tool defaults. Per-turn limits are applied by the Host.
  const inheritTools = bindingTools === undefined || (context.config.allowedTools !== undefined && bindingTools !== null)
  if (current.effective.replyMode === 'ai_auto' && current.effective.agentId === agentId &&
      current.effective.session.mode === 'fixed' && !inheritTools) return
  await context.agent.request('binding.update', {
    externalConversationId,
    expectedRevision: current.binding?.revision ?? 0,
    patch: {
      agentId,
      replyMode: 'ai_auto',
      session: { mode: 'fixed' },
      ...(inheritTools ? { resources: { tools: null } } : {}),
    },
  })
}

function startChannel(context: AppBackendContext) {
  if (!status(context).configured) return
  const controller = new AbortController()
  lifecycle = controller
  const deliveries = new Map<string, Record<string, unknown>>()

  async function deliver(event: Record<string, unknown>) {
    if (controller.signal.aborted || typeof event.turnId !== 'string') return
    const { turn } = await context.agent.request('turn.get', { turnId: event.turnId })
    if (!turn || turn.deliveredAt || typeof turn.externalEventId !== 'string') return
    const reply = { id: turn.externalEventId, turnId: event.turnId, text: event.text ?? event.message }
    deliveries.set(event.turnId, reply)
    if (connected && channel) write(channel.child, reply)
  }
  context.agent.on('turn.completed', deliver)
  context.agent.on('turn.failed', deliver)
  const showProgress = (context.config.responseMode ?? 'stream') === 'stream'
  const thinking = showProgress && context.config.showThinking === true
  const tools = showProgress && context.config.showToolHints === true
  if (thinking || tools) {
    context.host.on(agentProtocol, 'turn.progress', event => {
      if (controller.signal.aborted || !connected || !channel || typeof event.externalEventId !== 'string') return
      if (event.kind === 'thinking' && thinking) {
        write(channel.child, { id: event.externalEventId, progress: { kind: 'thinking' } })
      } else if (event.kind === 'tool' && tools && typeof event.toolName === 'string' &&
        ['started', 'completed', 'failed'].includes(String(event.phase))) {
        write(channel.child, {
          id: event.externalEventId,
          progress: { kind: 'tool', toolName: event.toolName, phase: event.phase },
        })
      }
    })
  }

  async function handle(event: GatewayEvent) {
    if (event.event === 'status') {
      connected = event.connected === true
      if (connected) {
        connectionError = undefined
        if (channel) for (const reply of deliveries.values()) write(channel.child, reply)
      }
    } else if (event.event === 'error' && typeof event.message === 'string') {
      connectionError = event.message
    } else if (event.event === 'message' && channel) {
      const { externalConversationId, externalUserId, externalEventId, text, mentioned, attachments } = event
      const child = channel.child
      if (typeof externalEventId !== 'string') return
      try {
        const input = {
          externalConversationId, externalUserId, externalEventId, text, mentioned, attachments,
        } as AgentHostRequestMap['turn.start']
        // The pinned SDK uses the generic host transport for the new turn option.
        const toolAllowlist = Array.isArray(context.config.allowedTools) ? context.config.allowedTools : undefined
        const turn = {
          ...input,
          ...((thinking || tools) && { progress: { thinking, tools } }),
          ...(toolAllowlist && { toolAllowlist }),
        }
        const result = thinking || tools || toolAllowlist
          ? await context.host.request(agentProtocol, 'turn.start', turn)
          : await context.agent.request('turn.start', input)
        if (typeof result.turnId !== 'string' || (!result.accepted && result.status !== 'failed')) {
          write(child, { id: externalEventId })
          return
        }
        if (result.status === 'completed' || result.status === 'failed') {
          const { turn } = await context.agent.request('turn.get', { turnId: result.turnId })
          if (turn && !turn.deliveredAt) {
            await deliver({ turnId: result.turnId, text: turn.resultText || turn.error })
          } else {
            write(child, { id: externalEventId })
          }
        }
      } catch (error) {
        const text = error instanceof AppServiceError && error.code === 'AGENT_CHANNEL_TOOLS_UNAVAILABLE'
          ? '所选工具已不可用，请在 Moss 中更新飞书通道设置。'
          : 'Moss 处理消息失败'
        write(child, { id: externalEventId, text })
      }
    } else if (event.event === 'delivered' && typeof event.turnId === 'string' &&
        typeof event.externalConversationId === 'string') {
      deliveries.delete(event.turnId)
      await context.agent.request('turn.delivery.ack', {
        turnId: event.turnId, externalConversationId: event.externalConversationId, ok: true,
      })
    } else if (event.event === 'missing_route' && typeof event.turnId === 'string') {
      deliveries.delete(event.turnId)
    }
  }

  const connect = async () => {
    if (controller.signal.aborted) return
    try {
      await updateBinding(context)
      channel = await launchGateway(context, {
        ...context.config, ...context.secrets, routeDir: context.dataDir,
      }, event => {
        void handle(event).catch(() => {})
      }, { signal: controller.signal })
      await channel.done
    } catch (error) {
      if (!controller.signal.aborted) {
        connectionError = error instanceof AppServiceError
          ? error.message : '连接失败，请检查飞书配置及 Moss 权限'
      }
    } finally {
      connected = false
      channel = undefined
      if (!controller.signal.aborted) retry = setTimeout(() => void connect(), 30_000)
    }
  }
  void connect()
}

async function stopChannel() {
  registration.stop()
  clearTimeout(retry)
  lifecycle?.abort()
  await channel?.done.catch(() => {})
}

function inputRecord(input: unknown) {
  if (typeof input !== 'object' || !input) throw new AppServiceError('INVALID_INPUT', '缺少配置')
  return input as Record<string, unknown>
}

defineAppBackend({
  'status.get': async (_input, context) => {
    const connection = status(context)
    if (!connection.configured || context.config.allowedTools !== undefined) return connection
    const current = await context.agent.request('binding.get', { externalConversationId: '*' }).catch(() => null)
    return { ...connection, allowedTools: current?.binding?.policy.resources?.tools }
  },
  'feishu.bot-creator.start': () => registration.start(),
  'feishu.bot-creator.poll': input => registration.poll(inputRecord(input).id),
  'feishu.bot-creator.stop': input => {
    const { id } = inputRecord(input)
    if (typeof id === 'string') registration.stop(id)
    return { stopped: true }
  },
  'channel.probe': async (input, context) => {
    const values = inputRecord(input)
    const appId = String(values.appId || '').trim()
    const existing = appId === context.config.appId
    const secret = (name: string) => typeof values[name] === 'string'
      ? String(values[name]).trim()
      : (existing ? context.secrets[name] || '' : '')
    const appSecret = secret('appSecret')
    if (!appId || !appSecret) throw new AppServiceError('INVALID_INPUT', '请填写 App ID 和 App Secret')
    if (channel && existing && appSecret === context.secrets.appSecret &&
        values.domain === (context.config.domain || 'feishu')) {
      return { connected: status(context).connected }
    }
    let ok = false
    const probe = await launchGateway(context, {
      ...values, appId, appSecret, encryptKey: secret('encryptKey'), verificationToken: secret('verificationToken'),
    }, event => { if (event.event === 'status') ok = event.connected === true }, { probe: true, signal: context.signal })
    if (await probe.done === 0 && ok) return { connected: true }
    throw new AppServiceError('FEISHU_CONNECTION_FAILED', '连接失败，请检查凭据和飞书开放平台的长连接设置')
  },
}, {
  onInitialize: startChannel,
  onShutdown: stopChannel,
})
