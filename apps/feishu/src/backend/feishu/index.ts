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
import { ProcessBridge } from '../common/process-bridge.js'
import { AppChannelBridge } from '../common/app-channel-bridge.js'
import { enqueue } from '../common/chat-queue.js'
import {
  loadConfig,
  loadConfigFromAppContext,
  type AdapterConfig,
} from '../common/config.js'
import { splitMessage } from '../common/format.js'
import { isAllowedUser as isLegacyAllowedUser } from '../common/pairing.js'
import { extractInboundPayload } from './extract-payload.js'
import { createFeishuConnectionLifecycle } from './connection-lifecycle.js'

const MAX_REPLY_CHARS = 4_000
const runsAsMossApp = process.env.MOSS_APP_ID === 'moss.feishu'

let config!: AdapterConfig
let larkClient!: InstanceType<typeof Lark.Client>
let wsClient: InstanceType<typeof Lark.WSClient> | null = null

const desktopBridge = runsAsMossApp
  ? new AppChannelBridge({ onShutdown: () => shutdown(false, false) })
  : new ProcessBridge()
const dedup = new MessageDedup()
const appAuthorizedUsers = new Set<string>()

function initializeTransport(context?: unknown): void {
  config = runsAsMossApp
    ? loadConfigFromAppContext((context || {}) as Parameters<typeof loadConfigFromAppContext>[0])
    : loadConfig()
  if (!config.feishu.appId || !config.feishu.appSecret) {
    throw new Error('Missing Feishu App ID or App Secret. Configure the moss.feishu App instance first.')
  }

  appAuthorizedUsers.clear()
  for (const userId of config.feishu.allowedUsers) appAuthorizedUsers.add(String(userId))
  for (const user of config.feishu.pairedUsers) appAuthorizedUsers.add(String(user.userId))

  larkClient = new Lark.Client({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
  })
}

function isAllowedUser(userId: string): boolean {
  return runsAsMossApp
    ? appAuthorizedUsers.has(String(userId))
    : isLegacyAllowedUser(userId)
}

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

  await desktopBridge.request('chat.message.received', {
    chatId,
    openId,
    eventId,
    text,
  })
}

desktopBridge.on('turn.completed', (payload: any) => {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : ''
  const turnId = typeof payload?.turnId === 'string' ? payload.turnId : ''
  const text = typeof payload?.text === 'string' ? payload.text : ''
  if (!chatId || !text) return
  enqueue(chatId, async () => {
    const delivered = await sendText(chatId, text, turnId || undefined)
    if (delivered && turnId) {
      await desktopBridge.request('turn.delivery.ack', { turnId, chatId })
    }
  })
})

desktopBridge.on('turn.failed', (payload: any) => {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : ''
  const turnId = typeof payload?.turnId === 'string' ? payload.turnId : ''
  if (!chatId) return
  enqueue(chatId, async () => {
    const message = typeof payload?.message === 'string' ? payload.message : 'Moss 会话处理失败。'
    const delivered = await sendText(chatId, `❌ ${message}`, turnId || undefined)
    if (delivered && turnId) {
      await desktopBridge.request('turn.delivery.ack', { turnId, chatId })
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
    const result = desktopBridge.available
      ? await desktopBridge.request('pairing.attempt', {
        chatId,
        openId: senderOpenId,
        eventId: messageId,
        code: pairText,
        displayName: 'Feishu User',
      }).catch((error) => {
        console.error('[Feishu] Unable to pair with Moss:', error)
        return { paired: false }
      }) as { paired?: boolean; alreadyPaired?: boolean; duplicate?: boolean }
      : { paired: false, alreadyPaired: false, duplicate: false }

    if (result.duplicate) {
      if (result.paired) await sendText(chatId, '已完成配对，可以直接发送消息。')
      return
    }
    if (!result.paired) {
      await sendText(chatId, '🔒 未授权。请在 Moss 中生成配对码后发送给我。')
      return
    }

    appAuthorizedUsers.add(senderOpenId)
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
    if (!desktopBridge.available) {
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
  if (!desktopBridge.available) {
    if (required) throw new Error('Moss host bridge disconnected during Feishu startup.')
    return
  }
  try {
    await desktopBridge.request('adapter.connection', {
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
  console.log(`[Feishu] Moss bridge: ${runsAsMossApp ? 'moss.channel/v1' : 'legacy process IPC'}`)

  if (!desktopBridge.available) throw new Error('Feishu Adapter must be started by a Moss host process.')
  const context = await desktopBridge.hello({ adapter: 'feishu' })
  initializeTransport(context)
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
  if (desktopBridge instanceof AppChannelBridge) desktopBridge.ready()
  console.log('[Feishu] Bot is running! (WebSocket connected)')
}

start().catch((error) => {
  console.error('[Feishu] Failed to start:', error)
  if (desktopBridge instanceof AppChannelBridge) desktopBridge.fail(error)
  process.exit(1)
})

function shutdown(exitProcess = true, destroyHostBridge = true): void {
  console.log('[Feishu] Shutting down...')
  wsClient?.close({ force: true })
  if (destroyHostBridge) desktopBridge.destroy()
  dedup.destroy()
  if (exitProcess) process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
