/**
 * Feishu private-chat transport for Moss.
 *
 * The mobile side intentionally has one narrow job: forward authorized text
 * messages into the fixed Moss conversation and send the final answer back as
 * ordinary Feishu messages. Session browsing, session control, cards and
 * attachment transfer stay outside this transport.
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import { MessageDedup } from '../common/message-dedup.js'
import { FeishuHostBridge } from '../common/app-channel-bridge.js'
import { enqueue } from '../common/chat-queue.js'
import {
  loadConfigFromAppContext,
  type AdapterConfig,
  type AppBackendConfigurationContext,
} from '../common/config.js'
import { splitMessage } from '../common/format.js'
import { extractInboundPayload } from './extract-payload.js'
import { createFeishuConnectionLifecycle } from './connection-lifecycle.js'
import { createFeishuStateStore } from './state-store.js'

const MAX_REPLY_CHARS = 4_000

let config!: AdapterConfig
let larkClient!: InstanceType<typeof Lark.Client>
let wsClient: InstanceType<typeof Lark.WSClient> | null = null
let stateStore!: ReturnType<typeof createFeishuStateStore>
let target = 'desktop'
let transportConnected = false
let transportError: string | null = null
let transportUpdatedAt: number | null = null

const hostBridge = new FeishuHostBridge({ onShutdown: () => shutdown(false, false) })
const dedup = new MessageDedup()

function initializeTransport(context: AppBackendConfigurationContext): void {
  config = loadConfigFromAppContext(context)
  if (!config.feishu.appId || !config.feishu.appSecret) {
    throw new Error('Missing Feishu App ID or App Secret. Configure the moss.feishu App instance first.')
  }
  if (!context.dataDir) throw new Error('Moss App data directory is unavailable.')
  target = context.target?.type === 'server' ? 'server' : 'desktop'
  stateStore = createFeishuStateStore(context.dataDir)
  stateStore.importLegacy({
    pairedUsers: config.feishu.pairedUsers,
    pairing: (context.config as Record<string, unknown> | undefined)?.pairing,
  })

  larkClient = new Lark.Client({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
  })
}

function isAllowedUser(userId: string): boolean {
  return config.feishu.allowedUsers.includes(String(userId)) || stateStore.isPaired(String(userId))
}

async function ensureAgentPolicy(): Promise<void> {
  const current = await hostBridge.requestAgent('binding.get', { externalConversationId: '*' })
  const effective = current?.effective || {}
  if (
    effective.replyMode === 'ai_auto'
    && effective.agentId == null
    && effective.session?.mode === 'fixed'
    && effective.proactive?.enabled === false
  ) return
  await hostBridge.requestAgent('binding.update', {
    externalConversationId: '*',
    expectedRevision: current?.binding?.revision || 0,
    patch: {
      replyMode: 'ai_auto',
      agentId: null,
      session: { mode: 'fixed', rotateAfterTurns: 24 },
      proactive: { enabled: false, maxConsecutiveReplies: 1, cooldownMs: 30_000 },
    },
  })
}

hostBridge.registerAction('status.get', () => ({
  target,
  transportConnected,
  transportError,
  transportUpdatedAt,
  pairedUsers: stateStore.listPairedUsers(),
  pairing: stateStore.pairingStatus(),
}))

hostBridge.registerAction('pairing.issue', () => ({
  pairing: stateStore.issuePairingCode(),
  pairedUsers: stateStore.listPairedUsers(),
}))

hostBridge.registerAction('pairing.list', () => ({
  pairing: stateStore.pairingStatus(),
  pairedUsers: stateStore.listPairedUsers(),
}))

hostBridge.registerAction('pairing.revoke', (input: { userId?: unknown } = {}) => {
  const userId = typeof input.userId === 'string' ? input.userId.trim() : ''
  if (!userId) throw new Error('A Feishu user ID is required.')
  return {
    revoked: stateStore.revoke(userId),
    pairing: stateStore.pairingStatus(),
    pairedUsers: stateStore.listPairedUsers(),
  }
})

function messageUuid(turnId: string | undefined, index: number): string | undefined {
  if (!turnId) return undefined
  return index === 0 ? turnId : `${turnId}-${index + 1}`
}

async function sendText(chatId: string, text: string, turnId?: string): Promise<boolean> {
  const chunks = splitMessage(String(text || '').trim(), MAX_REPLY_CHARS).filter(Boolean)
  if (!chunks.length) return false

  for (const [index, chunk] of chunks.entries()) {
    const content = JSON.stringify({ text: chunk })
    const uuid = messageUuid(turnId, index)
    try {
      const response = await larkClient.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text' as const,
          content,
          ...(uuid ? { uuid } : {}),
        },
      })
      if (!response.data?.message_id) return false
    } catch (error) {
      console.error('[Feishu] Send text error:', error)
      return false
    }
  }
  return true
}

async function forwardMessage({
  chatId,
  openId,
  eventId,
  text,
  hasAttachments,
}: {
  chatId: string
  openId: string
  eventId: string
  text: string
  hasAttachments: boolean
}): Promise<void> {
  if (hasAttachments) {
    await sendText(chatId, '当前飞书通道只支持文本消息。')
    return
  }

  await hostBridge.request('chat.message.received', {
    chatId,
    openId,
    eventId,
    text,
  })
}

hostBridge.on('turn.completed', (payload: any) => {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : ''
  const turnId = typeof payload?.turnId === 'string' ? payload.turnId : ''
  const text = typeof payload?.text === 'string' ? payload.text : ''
  if (!chatId || !text) return
  enqueue(chatId, async () => {
    const delivered = await sendText(chatId, text, turnId || undefined)
    if (delivered && turnId) {
      await hostBridge.request('turn.delivery.ack', { turnId, chatId })
    }
  })
})

hostBridge.on('turn.failed', (payload: any) => {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : ''
  const turnId = typeof payload?.turnId === 'string' ? payload.turnId : ''
  if (!chatId) return
  enqueue(chatId, async () => {
    const message = typeof payload?.message === 'string' ? payload.message : 'Moss 会话处理失败。'
    const delivered = await sendText(chatId, `❌ ${message}`, turnId || undefined)
    if (delivered && turnId) {
      await hostBridge.request('turn.delivery.ack', { turnId, chatId })
    }
  })
})

function stripMentions(text: string): string {
  return text.replace(/@_user_\d+/g, '').trim()
}

async function handleMessage(data: any): Promise<void> {
  const event = data as {
    sender?: { sender_id?: { open_id?: string } }
    message?: {
      message_id?: string
      chat_id?: string
      chat_type?: string
      content?: string
      message_type?: string
    }
  }

  const messageId = event.message?.message_id
  const chatId = event.message?.chat_id
  const senderOpenId = event.sender?.sender_id?.open_id
  const chatType = event.message?.chat_type
  const content = event.message?.content
  const msgType = event.message?.message_type

  if (!messageId || !chatId || !senderOpenId || !content || !msgType) return
  if (!dedup.tryRecord(messageId)) return
  if (chatType !== 'p2p') return

  if (!isAllowedUser(senderOpenId)) {
    const pairText = extractInboundPayload(content, msgType).text.trim()
    if (!pairText) return
    const result = stateStore.tryPair(pairText, {
      userId: senderOpenId,
      displayName: 'Feishu User',
    })
    if (!result.paired) {
      await sendText(chatId, '🔒 未授权。请在 Moss 中生成配对码后发送给我。')
      return
    }

    if (!result.alreadyPaired) {
      await sendText(chatId, '配对成功，可以直接发送消息。')
      return
    }
  }

  const payload = extractInboundPayload(content, msgType)
  const text = stripMentions(payload.text || '')
  const hasAttachments = payload.hasAttachments
  if (!text && !hasAttachments) return

  enqueue(chatId, async () => {
    if (!hostBridge.available) {
      await sendText(chatId, 'Moss 客户端连接已断开，请启动或重启 Moss 后再试。')
      return
    }
    try {
      await forwardMessage({
        chatId,
        openId: senderOpenId,
        eventId: messageId,
        text,
        hasAttachments,
      })
    } catch (error) {
      console.error('[Feishu] Moss request failed:', error)
      await sendText(chatId, 'Moss 客户端处理失败，请在桌面端查看详情后重试。')
    }
  })
}

async function reportConnection(connected: boolean, error?: unknown, required = false): Promise<void> {
  transportConnected = connected
  transportError = error ? (error instanceof Error ? error.message : String(error)) : null
  transportUpdatedAt = Date.now()
  hostBridge.status(connected ? 'connected' : 'disconnected', {
    connected,
    error: transportError,
    target,
  })
  if (!hostBridge.available) {
    if (required) throw new Error('Moss host bridge disconnected during Feishu startup.')
    return
  }
  try {
    await hostBridge.request('adapter.connection', {
      connected,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    })
  } catch (reportError) {
    console.error('[Feishu] Unable to report connection state:', reportError)
    if (required) throw reportError
  }
}

async function start(): Promise<void> {
  console.log('[Feishu] Starting bot...')
  console.log('[Feishu] Moss bridge: App Host')

  if (!hostBridge.available) throw new Error('Feishu App must be started by a Moss host process.')
  const context = await hostBridge.hello()
  initializeTransport(context)
  await ensureAgentPolicy()
  console.log(`[Feishu] App ID: ${config.feishu.appId}`)
  console.log('[Feishu] Moss host bridge ready')

  const dispatcher = new Lark.EventDispatcher({
    encryptKey: config.feishu.encryptKey,
    verificationToken: config.feishu.verificationToken,
  })
  dispatcher.register({
    'im.message.receive_v1': async (event: any) => {
      try {
        await handleMessage(event)
      } catch (error) {
        console.error('[Feishu] Message handler error:', error)
      }
    },
  } as any)

  const connection = createFeishuConnectionLifecycle(reportConnection)
  wsClient = new Lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.info,
    onReady: connection.onReady,
    onError: connection.onError,
    onReconnecting: connection.onReconnecting,
    onReconnected: connection.onReconnected,
  })

  await wsClient.start({ eventDispatcher: dispatcher })
  await connection.initialReady
  hostBridge.ready()
  console.log('[Feishu] Bot is running! (WebSocket connected)')
}

start().catch((error) => {
  console.error('[Feishu] Failed to start:', error)
  hostBridge.fail(error)
  process.exit(1)
})

function shutdown(exitProcess = true, destroyHostBridge = true): void {
  console.log('[Feishu] Shutting down...')
  wsClient?.close({ force: true })
  if (destroyHostBridge) hostBridge.destroy()
  dedup.destroy()
  if (exitProcess) process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
