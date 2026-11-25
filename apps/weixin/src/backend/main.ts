import { AppServiceError, defineAppBackend, type AgentHostRequestMap, type AppBackendContext } from '@moss/app-sdk'
import type { ChannelStatus } from '../contracts'
import { createRegistration } from './registration'
import { launchGateway, write, type GatewayEvent } from './gateway'

import { createTurnSender } from './turn'

const agentProtocol = 'moss.agent/v1'
const registration = createRegistration()
let channel: Awaited<ReturnType<typeof launchGateway>> | undefined
let lifecycle: AbortController | undefined
let retry: ReturnType<typeof setTimeout> | undefined
let connectionError: string | undefined
let connected = false
let turns: ReturnType<typeof createTurnSender> | undefined

function status(context: AppBackendContext): ChannelStatus {
  return {
    configured: Boolean(context.config.accountId && context.secrets.token),
    connected,
    error: connectionError,
    progressUnavailable: turns?.progressUnavailable,
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
  const sender = createTurnSender(context, thinking, tools)
  turns = sender
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
      const wasConnected = connected
      connected = event.connected === true
      connectionError = typeof event.error === 'string' ? event.error : undefined
      if (connected && !wasConnected && channel) {
        for (const reply of deliveries.values()) write(channel.child, reply)
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
        const result = await sender.start(input)
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
          ? '所选工具已不可用，请在 Moss 中更新微信通道设置。'
          : error instanceof AppServiceError && error.message === 'turn.start contains an unknown field: toolAllowlist'
            ? '当前 Moss 版本无法应用所选工具限制，请升级 Moss 后重试。'
            : 'Moss 处理消息失败，请在桌面端检查通道设置后重试。'
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
          ? error.message : '连接失败，请检查微信配置及 Moss 权限'
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
  'status.get': (_input, context) => status(context),
  'weixin.login.start': (_input, context) => registration.start(context),
  'weixin.login.poll': input => registration.poll(inputRecord(input).id),
  'weixin.login.stop': input => {
    const { id } = inputRecord(input)
    if (typeof id === 'string') registration.stop(id)
    return { stopped: true }
  },
}, {
  onInitialize: startChannel,
  onShutdown: stopChannel,
})
