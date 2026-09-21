/**
 * 飞书 (Feishu/Lark) Adapter for Claude Code Desktop
 *
 * 基于 @larksuiteoapi/node-sdk 的轻量飞书 Bot，通过进程 IPC 连接 Moss Desktop。
 * 使用 WebSocket 长连接接收事件，无需公网地址。
 *
 * 由 Moss Desktop 或 Moss Server 作为 IPC 子进程启动，不支持独立运行。
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { WsBridge, type ServerMessage, type AttachmentRef } from '../common/ws-bridge.js'
import { MessageDedup } from '../common/message-dedup.js'
import { ProcessBridge } from '../common/process-bridge.js'
import { AppChannelBridge } from '../common/app-channel-bridge.js'
import { StreamingCard } from './streaming-card.js'
import { enqueue } from '../common/chat-queue.js'
import {
  loadConfig,
  loadConfigFromAppContext,
  type AdapterConfig,
} from '../common/config.js'
import {
  formatImHelp,
  formatImStatus,
  splitMessage,
} from '../common/format.js'
import { SessionStore } from '../common/session-store.js'
import { AdapterHttpClient, type RecentProject } from '../common/http-client.js'
import { isAllowedUser as isLegacyAllowedUser } from '../common/pairing.js'
import { optimizeMarkdownForFeishu } from './markdown-style.js'
import { extractInboundPayload } from './extract-payload.js'
import { FeishuMediaService } from './media.js'
import { createFeishuConnectionLifecycle } from './connection-lifecycle.js'
import { AttachmentStore } from '../common/attachment/attachment-store.js'
import { checkAttachmentLimit } from '../common/attachment/attachment-limits.js'
import { ImageBlockWatcher } from '../common/attachment/image-block-watcher.js'
import type { PendingUpload } from '../common/attachment/attachment-types.js'
import {
  FEISHU_MENU_KEYS,
  buildSessionCenterCard,
  buildSessionSearchCard,
  buildSessionSelectedCard,
  isCurrentSessionIntent,
  isNewSessionIntent,
  isSessionCenterIntent,
  normalizeSessionCenterCategory,
  type SessionCenterCategory,
  type SessionCenterPage,
} from './session-center.js'

// ---------- init ----------

const runsAsMossApp = process.env.MOSS_APP_ID === 'moss.feishu'
let config!: AdapterConfig
let larkClient!: InstanceType<typeof Lark.Client>
let bridge!: WsBridge
let httpClient!: AdapterHttpClient
let media!: FeishuMediaService
let sessionStore!: SessionStore
let attachmentStore!: AttachmentStore
const desktopBridge = runsAsMossApp
  ? new AppChannelBridge({ onShutdown: () => shutdown(false, false) })
  : new ProcessBridge()
const dedup = new MessageDedup()
const appAuthorizedUsers = new Set<string>()

// Attachment plumbing — shared by inbound (download) and outbound (upload) paths.

// One streaming card lifecycle per chatId (CardKit main + patch fallback).
const streamingCards = new Map<string, StreamingCard>()
const pendingProjectSelection = new Map<string, boolean>()
const runtimeStates = new Map<string, ChatRuntimeState>()
const decisionMessages = new Map<string, Array<{
  chatId: string
  messageId: string
  title: string
  summary: string
}>>()

// Per-chat outbound watchers for Agent-produced markdown image references.
// `imageWatchers` extracts `![alt](src)` from streaming text;
// `uploadedImageKeys` caches fingerprint → image_key so the same image
// referenced multiple times in one turn isn't re-uploaded.
const imageWatchers = new Map<string, ImageBlockWatcher>()
const uploadedImageKeys = new Map<string, Map<string, string>>()

// Bot's own open_id (resolved on first message)
let botOpenId: string | null = null
// WSClient reference for graceful shutdown
let wsClient: InstanceType<typeof Lark.WSClient> | null = null

type ChatRuntimeState = {
  state: 'idle' | 'thinking' | 'streaming' | 'tool_executing' | 'permission_pending'
  verb?: string
  model?: string
  pendingPermissionCount: number
}

type DesktopSessionOption = {
  id: string
  title: string
  preview?: string
  updatedAt: number
  busy: boolean
  projectName?: string | null
  originChannel?: 'desktop' | 'feishu' | 'cron'
}

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
  if (!runsAsMossApp) {
    bridge = new WsBridge(config.serverUrl, 'feishu')
    httpClient = new AdapterHttpClient(config.serverUrl)
    sessionStore = new SessionStore()
  }
  attachmentStore = new AttachmentStore(runsAsMossApp && context && typeof context === 'object'
    ? { root: path.join(String((context as { dataDir?: string }).dataDir || process.cwd()), 'attachments') }
    : undefined)
  media = new FeishuMediaService(larkClient, attachmentStore)
  attachmentStore.gc().catch((error) => {
    console.warn('[Feishu] AttachmentStore.gc failed:', error instanceof Error ? error.message : error)
  })
}

function isAllowedUser(userId: string): boolean {
  return runsAsMossApp
    ? appAuthorizedUsers.has(String(userId))
    : isLegacyAllowedUser(userId)
}

// ---------- helpers ----------

function getRuntimeState(chatId: string): ChatRuntimeState {
  let state = runtimeStates.get(chatId)
  if (!state) {
    state = { state: 'idle', pendingPermissionCount: 0 }
    runtimeStates.set(chatId, state)
  }
  return state
}

/** Get the existing StreamingCard for this chat, or create one in 'idle' state. */
function getOrCreateStreamingCard(chatId: string, messageUuid?: string, sessionTitle?: string): StreamingCard {
  let card = streamingCards.get(chatId)
  if (!card) {
    card = new StreamingCard({ larkClient, chatId, messageUuid, sessionTitle })
    streamingCards.set(chatId, card)
  } else if (sessionTitle) {
    card.setSessionTitle(sessionTitle)
  }
  return card
}

function getImageWatcher(chatId: string): ImageBlockWatcher {
  let w = imageWatchers.get(chatId)
  if (!w) {
    w = new ImageBlockWatcher()
    imageWatchers.set(chatId, w)
  }
  return w
}

function getUploadedKeys(chatId: string): Map<string, string> {
  let m = uploadedImageKeys.get(chatId)
  if (!m) {
    m = new Map()
    uploadedImageKeys.set(chatId, m)
  }
  return m
}

/** Upload a PendingUpload found in streaming output and send it as an
 *  independent im.message.create({msg_type:'image'}) message — runs
 *  fire-and-forget so the streaming card is never blocked. All failure
 *  modes are non-fatal: log and skip. */
async function dispatchOutboundImage(chatId: string, pending: PendingUpload): Promise<void> {
  const cache = getUploadedKeys(chatId)
  if (cache.has(pending.id)) return // already uploaded within this chat

  try {
    let buffer: Buffer
    let mime = 'image/png'
    switch (pending.source.kind) {
      case 'base64': {
        buffer = Buffer.from(pending.source.data, 'base64')
        mime = pending.source.mime
        break
      }
      case 'path': {
        buffer = await fs.readFile(pending.source.path)
        mime = pending.source.mime ?? 'image/png'
        break
      }
      case 'url': {
        const resp = await fetch(pending.source.url)
        if (!resp.ok) throw new Error(`fetch ${pending.source.url} -> ${resp.status}`)
        buffer = Buffer.from(await resp.arrayBuffer())
        mime = pending.source.mime ?? resp.headers.get('content-type') ?? 'image/png'
        break
      }
    }

    const check = checkAttachmentLimit('image', buffer.length, mime)
    if (!check.ok) {
      console.warn('[Feishu] Outbound image rejected:', check.hint)
      return
    }

    const imageKey = await media.uploadImage(buffer, mime)
    cache.set(pending.id, imageKey)
    await media.sendImageMessage(chatId, imageKey)
  } catch (err) {
    console.error(
      '[Feishu] dispatchOutboundImage failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

/** Finalize and remove the streaming card (normal completion). */
async function finalizeStreamingCard(chatId: string): Promise<boolean> {
  const card = streamingCards.get(chatId)
  if (!card) return false
  streamingCards.delete(chatId)
  return card.finalize()
}

/** Abort and remove the streaming card (error path). Non-throwing. */
async function abortStreamingCard(chatId: string, err: Error): Promise<boolean> {
  const card = streamingCards.get(chatId)
  if (!card) return false
  streamingCards.delete(chatId)
  return card.abort(err).catch(() => false)
}

function clearTransientChatState(chatId: string): void {
  // Abort any in-flight streaming card (best effort, don't block)
  const card = streamingCards.get(chatId)
  if (card) {
    streamingCards.delete(chatId)
    void card.abort(new Error('session cleared')).catch(() => {})
  }
  imageWatchers.delete(chatId)
  uploadedImageKeys.delete(chatId)
  const runtime = getRuntimeState(chatId)
  runtime.state = 'idle'
  runtime.verb = undefined
  runtime.pendingPermissionCount = 0
}

async function ensureExistingSession(chatId: string): Promise<{ sessionId: string; workDir: string } | null> {
  const stored = sessionStore.get(chatId)
  if (!stored) return null

  if (!bridge.hasSession(chatId)) {
    bridge.connectSession(chatId, stored.sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    const opened = await bridge.waitForOpen(chatId)
    if (!opened) return null
  }

  return stored
}

async function buildStatusText(chatId: string): Promise<string> {
  const stored = await ensureExistingSession(chatId)
  if (!stored) return formatImStatus(null)

  const runtime = getRuntimeState(chatId)
  let projectName = path.basename(stored.workDir) || stored.workDir
  let branch: string | null = null

  try {
    const gitInfo = await httpClient.getGitInfo(stored.sessionId)
    projectName = gitInfo.repoName || path.basename(gitInfo.workDir) || projectName
    branch = gitInfo.branch
  } catch {
    // Ignore git lookup failures and fall back to stored workDir
  }

  let taskCounts:
    | {
        total: number
        pending: number
        inProgress: number
        completed: number
      }
    | undefined

  try {
    const tasks = await httpClient.getTasksForSession(stored.sessionId)
    if (tasks.length > 0) {
      taskCounts = {
        total: tasks.length,
        pending: tasks.filter((task) => task.status === 'pending').length,
        inProgress: tasks.filter((task) => task.status === 'in_progress').length,
        completed: tasks.filter((task) => task.status === 'completed').length,
      }
    }
  } catch {
    // Ignore task lookup failures in IM status summary
  }

  return formatImStatus({
    sessionId: stored.sessionId,
    projectName,
    branch,
    model: runtime.model,
    state: runtime.state,
    verb: runtime.verb,
    pendingPermissionCount: runtime.pendingPermissionCount,
    taskCounts,
  })
}

type FeishuReceiveIdType = 'chat_id' | 'open_id'

async function sendTextTo(
  receiveId: string,
  receiveIdType: FeishuReceiveIdType,
  text: string,
  replyToMessageId?: string,
  messageUuid?: string,
): Promise<string | undefined> {
  const content = JSON.stringify({
    zh_cn: { content: [[{ tag: 'md', text }]] },
  })

  try {
    if (replyToMessageId) {
      const resp = await larkClient.im.message.reply({
        path: { message_id: replyToMessageId },
        data: { content, msg_type: 'post' },
      })
      return resp.data?.message_id
    }
    const resp = await larkClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        msg_type: 'post' as const,
        content,
        ...(messageUuid ? { uuid: messageUuid } : {}),
      },
    })
    return resp.data?.message_id
  } catch (err) {
    console.error('[Feishu] Send text error:', err)
    return undefined
  }
}

/** Send a text message (post format). */
async function sendText(
  chatId: string,
  text: string,
  replyToMessageId?: string,
  messageUuid?: string,
): Promise<string | undefined> {
  return sendTextTo(chatId, 'chat_id', text, replyToMessageId, messageUuid)
}

async function sendCardTo(
  receiveId: string,
  receiveIdType: FeishuReceiveIdType,
  card: Record<string, unknown>,
  messageUuid?: string,
): Promise<string | undefined> {
  try {
    const resp = await larkClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
        ...(messageUuid ? { uuid: messageUuid } : {}),
      },
    })
    return resp.data?.message_id
  } catch (err) {
    console.error('[Feishu] Send card error:', err)
    return undefined
  }
}

/** Send an interactive card to a chat. */
async function sendCard(
  chatId: string,
  card: Record<string, unknown>,
  messageUuid?: string,
): Promise<string | undefined> {
  return sendCardTo(chatId, 'chat_id', card, messageUuid)
}

/** Pretty-print an absolute path for IM display.
 *  - Replace $HOME with `~`
 *  - Middle-truncate if it's still very long, keeping the project tail visible */
function prettyPath(realPath: string, maxLen = 64): string {
  const home = process.env.HOME
  let p = realPath
  if (home) {
    if (p === home) return '~'
    if (p.startsWith(`${home}/`)) p = `~${p.slice(home.length)}`
  }
  if (p.length <= maxLen) return p
  // Project name lives at the tail — keep more of the tail than the head.
  const tailLen = Math.floor(maxLen * 0.65)
  const headLen = maxLen - tailLen - 1
  return `${p.slice(0, headLen)}…${p.slice(-tailLen)}`
}

/** Build an interactive project picker card — mobile-first layout.
 *
 *  Design: one column_set per project with exactly 2 columns:
 *    - Col 1 (weighted): project info (title markdown + small grey path)
 *    - Col 2 (auto):     "选择" button, vertically centered
 *
 *  Only 2 columns with one weighted + one auto means the weight distribution
 *  is trivial (auto takes its natural width, weighted takes the rest). This
 *  avoids the layout issues seen in 3-column attempts. */
function buildProjectPickerCard(projects: RecentProject[]): Record<string, unknown> {
  const items = projects.slice(0, 10)
  const total = projects.length
  const subtitleText =
    total > items.length
      ? `共 ${total} 个最近项目，显示前 ${items.length}`
      : `共 ${total} 个最近项目`

  const rows = items.map((p, i) => {
    const branch = p.branch ? `  ·  *${p.branch}*` : ''
    return {
      tag: 'column_set',
      flex_mode: 'stretch',
      horizontal_spacing: '8px',
      margin: i === 0 ? '0px 0 0 0' : '10px 0 0 0',
      columns: [
        // Col 1 — project info (title + notation path, stacked)
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          vertical_align: 'center',
          elements: [
            {
              tag: 'markdown',
              content: `**${p.projectName}**${branch}`,
            },
            {
              tag: 'markdown',
              content: prettyPath(p.realPath, 56),
              text_size: 'notation',
              margin: '2px 0 0 0',
            },
          ],
        },
        // Col 2 — action button (auto width, vertically centered)
        {
          tag: 'column',
          width: 'auto',
          vertical_align: 'center',
          elements: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '选择' },
              type: i === 0 ? 'primary' : 'default',
              size: 'small',
              value: {
                action: 'pick_project',
                realPath: p.realPath,
                projectName: p.projectName,
              },
            },
          ],
        },
      ],
    }
  })

  return {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      title: { tag: 'plain_text', content: '📁 选择项目' },
      subtitle: { tag: 'plain_text', content: subtitleText },
      template: 'blue',
    },
    body: {
      elements: [
        ...rows,
        { tag: 'hr', margin: '14px 0 0 0' },
        {
          tag: 'markdown',
          content: '💡 点击右侧 **选择** 按钮，或发送 `/new <项目名>`',
          text_size: 'notation',
          margin: '6px 0 0 0',
        },
      ],
    },
  }
}

function escapeCardMarkdown(value: unknown): string {
  return String(value || '').replace(/([\\`*_{}\[\]()#+.!|>~-])/g, '\\$1')
}

function buildNotificationCard(payload: {
  title?: string
  summary?: string
  decisionRequestId?: string
  actionToken?: string
}): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [{
    tag: 'markdown',
    content: escapeCardMarkdown(payload.summary || 'Moss 有一条新消息。'),
  }]
  if (payload.decisionRequestId && payload.actionToken) {
    elements.push({ tag: 'hr', margin: '12px 0 0 0' })
    elements.push({
      tag: 'column_set',
      flex_mode: 'stretch',
      horizontal_spacing: '8px',
      margin: '8px 0 0 0',
      columns: [
        {
          tag: 'column', width: 'weighted', weight: 1,
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '允许一次' },
            type: 'primary',
            value: {
              action: 'decision',
              decisionId: payload.decisionRequestId,
              actionToken: payload.actionToken,
              allowed: true,
            },
          }],
        },
        {
          tag: 'column', width: 'weighted', weight: 1,
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '拒绝' },
            type: 'danger',
            value: {
              action: 'decision',
              decisionId: payload.decisionRequestId,
              actionToken: payload.actionToken,
              allowed: false,
            },
          }],
        },
      ],
    })
  }
  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: 'plain_text', content: String(payload.title || 'Moss 消息') },
      template: 'orange',
    },
    body: {
      elements,
    },
  }
}

function buildResolvedNotificationCard(entry: { title: string; summary: string }, status: string) {
  const allowed = status === 'resolved'
  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: 'plain_text', content: entry.title },
      subtitle: { tag: 'plain_text', content: allowed ? '已允许' : status === 'rejected' ? '已拒绝' : '已失效' },
      template: allowed ? 'green' : status === 'rejected' ? 'red' : 'grey',
    },
    body: {
      elements: [{ tag: 'markdown', content: escapeCardMarkdown(entry.summary) }],
    },
  }
}

/** Human-readable summary of a tool call for display in the permission card. */
type ToolCallSummary = {
  icon: string
  label: string
  /** Display string for the operation target (file path or command preview) */
  target?: string
  /** Absolute file path for cross-directory detection, when applicable */
  filePath?: string
}

/** Map a Claude Code tool call to an icon + human-readable Chinese label.
 *  Unknown tools fall back to the raw tool name with a generic icon. */
function summarizeToolCall(toolName: string, input: unknown): ToolCallSummary {
  const rec: Record<string, unknown> =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const str = (key: string): string | undefined =>
    typeof rec[key] === 'string' ? (rec[key] as string) : undefined

  switch (toolName) {
    case 'Write': {
      const fp = str('file_path')
      return { icon: '✏️', label: '写入文件', target: fp, filePath: fp }
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const fp = str('file_path') ?? str('notebook_path')
      return { icon: '✏️', label: '修改文件', target: fp, filePath: fp }
    }
    case 'Read': {
      const fp = str('file_path')
      return { icon: '📖', label: '读取文件', target: fp, filePath: fp }
    }
    case 'Bash':
    case 'BashOutput': {
      return { icon: '🖥️', label: '执行命令', target: str('command') }
    }
    case 'Grep': {
      const pattern = str('pattern')
      return {
        icon: '🔍',
        label: '搜索内容',
        target: pattern ? `pattern: ${pattern}` : undefined,
        filePath: str('path'),
      }
    }
    case 'Glob': {
      const pattern = str('pattern')
      return {
        icon: '📁',
        label: '查找文件',
        target: pattern ? `pattern: ${pattern}` : undefined,
        filePath: str('path'),
      }
    }
    case 'WebFetch':
      return { icon: '🌐', label: '访问网页', target: str('url') }
    case 'WebSearch':
      return { icon: '🌐', label: '搜索网页', target: str('query') }
    default:
      return { icon: '🔧', label: toolName }
  }
}

/** True if `filePath` resolves to a location outside of `workDir`.
 *  Relative paths are resolved against workDir first. */
function isOutsideWorkDir(filePath: string, workDir: string): boolean {
  const abs = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(workDir, filePath)
  const normWork = path.normalize(workDir).replace(/\/+$/, '')
  return abs !== normWork && !abs.startsWith(normWork + path.sep)
}

/** Truncate a single-line target preview (e.g. shell command) to maxLen. */
function truncateTarget(s: string, maxLen = 160): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1) + '…'
}

/** Build a permission request card (Schema 2.0, mobile-friendly).
 *
 *  Layout:
 *    header  →  🔐 需要权限确认 (orange / red if cross-dir)
 *    body    →  <icon> **<label>**  `<toolName>`
 *              ```
 *              <target>           (path or command, if present)
 *              ```
 *              ⚠️ 跨目录警告        (only when filePath escapes workDir)
 *              ────
 *              [ ✅ 允许 | ♾️ 永久允许 | ❌ 拒绝 ]
 *
 *  The 永久允许 button carries `rule: 'always'` in its value — the server
 *  turns that into `updatedPermissions` using the CLI's permission_suggestions,
 *  so the same tool call won't prompt again in this session. */
function buildPermissionCard(
  toolName: string,
  input: unknown,
  requestId: string,
  workDir?: string,
): Record<string, unknown> {
  const summary = summarizeToolCall(toolName, input)
  const crossDir = Boolean(
    workDir && summary.filePath && isOutsideWorkDir(summary.filePath, workDir),
  )

  const elements: Record<string, unknown>[] = [
    // Header line: icon + human label + raw tool tag
    {
      tag: 'markdown',
      content: `${summary.icon} **${summary.label}**  \`${toolName}\``,
    },
  ]

  // Target preview (file path / command / url …)
  if (summary.target) {
    const shown = summary.filePath
      ? prettyPath(summary.target, 80)
      : truncateTarget(summary.target, 160)
    elements.push({
      tag: 'markdown',
      content: '```\n' + shown + '\n```',
      margin: '4px 0 0 0',
    })
  }

  // Cross-directory warning (only when the file escapes the session's workDir)
  if (crossDir) {
    elements.push({
      tag: 'markdown',
      content: '⚠️ **该操作位于当前项目目录之外**',
      margin: '8px 0 0 0',
      text_size: 'notation',
    })
  }

  // Divider
  elements.push({ tag: 'hr', margin: '12px 0 0 0' })

  // Action row — three equal columns: 允许 / 永久允许 / 拒绝
  elements.push({
    tag: 'column_set',
    flex_mode: 'stretch',
    horizontal_spacing: '8px',
    margin: '8px 0 0 0',
    columns: [
      {
        tag: 'column',
        width: 'weighted',
        weight: 1,
        vertical_align: 'center',
        elements: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '✅ 允许' },
            type: 'primary',
            size: 'medium',
            value: { action: 'permit', requestId, allowed: true },
          },
        ],
      },
      {
        tag: 'column',
        width: 'weighted',
        weight: 1,
        vertical_align: 'center',
        elements: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '♾️ 永久允许' },
            type: 'default',
            size: 'medium',
            value: { action: 'permit', requestId, allowed: true, rule: 'always' },
          },
        ],
      },
      {
        tag: 'column',
        width: 'weighted',
        weight: 1,
        vertical_align: 'center',
        elements: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '❌ 拒绝' },
            type: 'danger',
            size: 'medium',
            value: { action: 'permit', requestId, allowed: false },
          },
        ],
      },
    ],
  })

  return {
    schema: '2.0',
    config: {
      wide_screen_mode: false,
      update_multi: true,
    },
    header: {
      title: { tag: 'plain_text', content: '🔐 需要权限确认' },
      subtitle: {
        tag: 'plain_text',
        content: crossDir ? '⚠️ 跨目录操作' : toolName,
      },
      template: crossDir ? 'red' : 'orange',
      padding: '12px 12px 12px 12px',
      icon: { tag: 'standard_icon', token: 'lock-chat_filled' },
    },
    body: { elements },
  }
}

// ---------- session management ----------

async function ensureSession(chatId: string): Promise<boolean> {
  if (bridge.hasSession(chatId)) return true

  const stored = sessionStore.get(chatId)
  if (stored) {
    bridge.connectSession(chatId, stored.sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    return await bridge.waitForOpen(chatId)
  }

  const workDir = config.defaultProjectDir
  if (workDir) {
    return await createSessionForChat(chatId, workDir)
  }

  await showProjectPicker(chatId)
  return false
}

async function createSessionForChat(chatId: string, workDir: string): Promise<boolean> {
  try {
    // Always tear down any stale WS connection before creating a new session.
    // Without this, bridge.connectSession() below would short-circuit when an
    // old OPEN connection still exists (e.g. /projects → pick_project path),
    // leaving user messages routed to the previous session's workDir.
    bridge.resetSession(chatId)
    // Also abort any in-flight streaming card tied to the old session.
    const inflightCard = streamingCards.get(chatId)
    if (inflightCard) {
      streamingCards.delete(chatId)
      void inflightCard.abort(new Error('session reset')).catch(() => {})
    }

    const sessionId = await httpClient.createSession(workDir)
    sessionStore.set(chatId, sessionId, workDir)
    bridge.connectSession(chatId, sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    const opened = await bridge.waitForOpen(chatId)
    if (!opened) {
      await sendText(chatId, '⚠️ 连接服务器超时，请重试。')
      return false
    }
    return true
  } catch (err) {
    await sendText(chatId, `❌ 无法创建会话: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

async function showProjectPicker(chatId: string): Promise<void> {
  try {
    const projects = await httpClient.listRecentProjects()
    if (projects.length === 0) {
      await sendText(chatId,
        '没有找到最近的项目。请先在 Desktop App 中打开一个项目，或在设置中配置默认项目。')
      return
    }
    pendingProjectSelection.set(chatId, true)
    const cardId = await sendCard(chatId, buildProjectPickerCard(projects))
    if (!cardId) {
      // Fallback to text picker if card delivery failed (permissions, etc.)
      const lines = projects.slice(0, 10).map((p, i) =>
        `${i + 1}. **${p.projectName}**${p.branch ? ` (${p.branch})` : ''}\n   ${p.realPath}`
      )
      await sendText(chatId, `选择项目（回复编号）：\n\n${lines.join('\n\n')}\n\n💡 下次可直接 /new <编号或名称> 快速新建会话`)
    }
  } catch (err) {
    await sendText(chatId, `❌ 无法获取项目列表: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function startNewSession(chatId: string, query?: string): Promise<void> {
  bridge.resetSession(chatId)
  sessionStore.delete(chatId)
  // Abort any in-flight streaming card for the previous session
  const inflightCard = streamingCards.get(chatId)
  if (inflightCard) {
    streamingCards.delete(chatId)
    void inflightCard.abort(new Error('session reset')).catch(() => {})
  }
  imageWatchers.delete(chatId)
  uploadedImageKeys.delete(chatId)
  pendingProjectSelection.delete(chatId)
  runtimeStates.delete(chatId)

  if (query) {
    try {
      const { project, ambiguous } = await httpClient.matchProject(query)
      if (project) {
        const ok = await createSessionForChat(chatId, project.realPath)
        if (ok) {
          await sendText(chatId,
            `✅ 已新建会话：**${project.projectName}**${project.branch ? ` (${project.branch})` : ''}`)
        }
        return
      }
      if (ambiguous) {
        const list = ambiguous.map((p, i) => `${i + 1}. **${p.projectName}** — ${p.realPath}`).join('\n')
        await sendText(chatId, `匹配到多个项目，请更精确：\n\n${list}`)
        return
      }
      await sendText(chatId, `未找到匹配 "${query}" 的项目。发送 /projects 查看完整列表。`)
    } catch (err) {
      await sendText(chatId, `❌ ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    const workDir = config.defaultProjectDir
    if (workDir) {
      const ok = await createSessionForChat(chatId, workDir)
      if (ok) {
        await sendText(chatId, '✅ 已新建会话，可以开始对话了。')
      }
    } else {
      await showProjectPicker(chatId)
    }
  }
}

// ---------- server message handler ----------

async function handleServerMessage(chatId: string, msg: ServerMessage): Promise<boolean | void> {
  const runtime = getRuntimeState(chatId)

  switch (msg.type) {
    case 'connected':
      break

    case 'status': {
      runtime.state = msg.state
      runtime.verb = typeof msg.verb === 'string' ? msg.verb : undefined
      // 注意: 故意不在 thinking 时创建卡片。/clear、/compact 这类命令
      // 不产生文本输出，但 CLI 仍会发 thinking → message_complete 事件。
      // 如果在 thinking 就建卡，这些命令会留下一张空卡片。
      // 真正的创建时机是 content_start{text} 或第一次 content_delta。
      break
    }

    case 'content_start': {
      if (msg.blockType === 'text') {
        // 幂等: 预建卡或上一次 content_delta 已经创建了卡片则复用，否则现在创建
        const card = getOrCreateStreamingCard(chatId)
        await card.ensureCreated().catch((err) => {
          console.error('[Feishu] ensureCreated on content_start failed:', err)
        })
      } else if (msg.blockType === 'tool_use') {
        // 把工具调用起点登记到已存在的卡 —— 让用户看到 "⚙️ 运行中..." 指示。
        // 只读 map，不 getOrCreate: /clear 这类无回复命令不应该因为上游发了
        // 孤立的 tool_use 事件而被迫建一张空卡。
        const card = streamingCards.get(chatId)
        if (card) {
          card.startTool(msg.toolUseId, msg.toolName)
        }
      }
      // 注意: tool_use 不 finalize 当前卡。让整个 turn 的所有文本输出
      // 合并到同一张卡里 —— 更接近 Desktop UI 的一体化答复体验，也避免
      // "预建空卡 + tool_use finalize → 留下空白卡" 的视觉 bug。
      break
    }

    case 'content_delta': {
      if (typeof msg.text === 'string' && msg.text) {
        // 正常情况 content_start{text} 已经创建了卡片，这里直接 appendText。
        // 极端情况（上游跳过了 content_start）也要能容错 —— getOrCreate + async ensureCreated。
        const card = getOrCreateStreamingCard(chatId)
        // ensureCreated 幂等，已 streaming 时是 no-op
        void card.ensureCreated().catch((err) => {
          console.error('[Feishu] ensureCreated on delta failed:', err)
        })
        card.appendText(msg.text)

        // Watch the streaming text for outbound markdown image references
        // (`![alt](src)`) and dispatch each new one as a standalone
        // im.message.create({msg_type:'image'}) — fire-and-forget so the
        // streaming card never waits on upload RTT. The image arrives in
        // chat as a separate message alongside the streaming card text.
        const newUploads = getImageWatcher(chatId).feed(msg.text)
        for (const pending of newUploads) {
          void dispatchOutboundImage(chatId, pending)
        }
      }
      break
    }

    case 'thinking': {
      // 推理文本（reasoning）—— 作为卡片顶部的 blockquote 预览持续更新，
      // 让用户在工具执行期间也能看到模型的思考过程。
      // 同样不 auto-create: 没有预建卡的命令路径不应该被 thinking 事件撑出一张空卡。
      const card = streamingCards.get(chatId)
      if (card && typeof msg.text === 'string' && msg.text) {
        card.appendReasoning(msg.text)
      }
      break
    }

    case 'tool_use_complete': {
      // 把对应 tool step 从 "⚙️ running" 切到 "✅ done"，让用户看到进度推进。
      const card = streamingCards.get(chatId)
      if (card) {
        card.completeTool(msg.toolUseId, msg.toolName)
      }
      break
    }

    case 'tool_result':
      // Tool errors are handled internally by the AI (retries etc.)
      break

    case 'permission_request': {
      runtime.pendingPermissionCount += 1
      runtime.state = 'permission_pending'
      const stored = sessionStore.get(chatId)
      const card = buildPermissionCard(
        msg.toolName,
        msg.input,
        msg.requestId,
        stored?.workDir,
      )
      await sendCard(chatId, card)
      break
    }

    case 'message_complete':
      runtime.state = 'idle'
      runtime.verb = undefined
      return finalizeStreamingCard(chatId)

    case 'error':
      runtime.state = 'idle'
      runtime.verb = undefined
      // Auto-recover from stale thinking block signatures by creating a fresh session.
      if (msg.message && /Invalid.*signature.*thinking/i.test(msg.message)) {
        // Abort any in-flight streaming card first
        if (streamingCards.has(chatId)) {
          const card = streamingCards.get(chatId)!
          streamingCards.delete(chatId)
          void card.abort(new Error('session reset')).catch(() => {})
        }
        const stored = sessionStore.get(chatId)
        const workDir = stored?.workDir || config.defaultProjectDir
        if (workDir) {
          await sendText(chatId, '⚠️ 会话上下文已失效，正在自动重建...')
          bridge.resetSession(chatId)
          sessionStore.delete(chatId)
          imageWatchers.delete(chatId)
          uploadedImageKeys.delete(chatId)
          runtimeStates.delete(chatId)
          const ok = await createSessionForChat(chatId, workDir)
          if (ok) {
            await sendText(chatId, '✅ 已重建会话，请重新发送消息。')
          } else {
            await sendText(chatId, '❌ 重建会话失败，请发送 /new 手动新建。')
          }
        } else {
          await sendText(chatId, '⚠️ 会话上下文已失效，请发送 /new 新建会话。')
        }
      } else if (streamingCards.has(chatId)) {
        await abortStreamingCard(chatId, new Error(msg.message ?? 'unknown error'))
      } else {
        await sendText(chatId, `❌ ${msg.message}`)
      }
      break

    case 'system_notification':
      if (msg.subtype === 'init' && msg.data && typeof msg.data === 'object') {
        const model = (msg.data as Record<string, unknown>).model
        if (typeof model === 'string' && model.trim()) {
          runtime.model = model
        }
      }
      break
  }
}

function desktopIdentity(chatId: string, openId: string, eventId?: string) {
  return {
    chatId,
    openId,
    ...(eventId ? { eventId } : {}),
  }
}

async function showSessionCenter({
  chatId,
  openId,
  category = 'recent',
  page = 0,
  query = '',
  receiveId,
  receiveIdType = 'chat_id',
}: {
  chatId?: string
  openId: string
  category?: SessionCenterCategory
  page?: number
  query?: string
  receiveId?: string
  receiveIdType?: FeishuReceiveIdType
}): Promise<void> {
  const result = await desktopBridge.request('conversation.list', {
    ...(chatId ? { chatId } : {}),
    openId,
    category,
    page,
    pageSize: 5,
    query,
  }) as SessionCenterPage & { chatId?: string }
  const targetId = receiveId || result.chatId || chatId
  if (!targetId) throw new Error('Unable to resolve the Feishu conversation.')
  await sendCardTo(targetId, receiveIdType, buildSessionCenterCard(result))
}

async function handleDesktopChatInput({
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
    await sendText(chatId, '当前 Moss 客户端飞书通道先支持文本消息，附件将在后续版本接入。')
    return
  }

  if (text === '/help' || text === '帮助') {
    await showSessionCenter({ chatId, openId })
    return
  }

  if (isNewSessionIntent(text)) {
    const title = text.startsWith('/new ') ? text.slice(5).trim() : ''
    const result = await desktopBridge.request('conversation.new', {
      ...desktopIdentity(chatId, openId, eventId),
      title,
    }) as { session?: DesktopSessionOption }
    if (result.session) {
      await sendCard(chatId, buildSessionSelectedCard(result.session))
    }
    return
  }

  if (isSessionCenterIntent(text)) {
    const query = text.startsWith('/sessions ') ? text.slice('/sessions '.length).trim() : ''
    await showSessionCenter({ chatId, openId, query })
    return
  }

  if (isCurrentSessionIntent(text)) {
    const result = await desktopBridge.request('conversation.current', desktopIdentity(chatId, openId)) as {
      session?: DesktopSessionOption | null
    }
    if (!result.session) {
      await showSessionCenter({ chatId, openId })
      return
    }
    await sendCard(chatId, buildSessionSelectedCard(result.session))
    return
  }

  if (text === '/stop' || text === '停止') {
    const result = await desktopBridge.request(
      'session.abort',
      desktopIdentity(chatId, openId, eventId),
    ) as {
      cancelled?: number
    }
    clearTransientChatState(chatId)
    await sendText(chatId, result.cancelled
      ? `已停止当前执行，并取消 ${result.cancelled} 条排队消息。`
      : '已发送停止信号。')
    return
  }

  if (text === '/projects' || text === '项目列表') {
    await showSessionCenter({ chatId, openId, category: 'project' })
    return
  }

  const result = await desktopBridge.request('chat.message.received', {
    ...desktopIdentity(chatId, openId, eventId),
    text,
  }) as {
    accepted?: boolean
    duplicate?: boolean
    status?: string
    turnId?: string | null
    session?: DesktopSessionOption
  }
  if (result.accepted || (result.duplicate && ['accepted', 'running'].includes(result.status || ''))) {
    const card = getOrCreateStreamingCard(chatId, result.turnId || undefined, result.session?.title)
    void card.ensureCreated().catch((error) => {
      console.error('[Feishu] Unable to create Moss response card:', error)
    })
  }
}

desktopBridge.on('turn.completed', (payload: any) => {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : ''
  const turnId = typeof payload?.turnId === 'string' ? payload.turnId : ''
  if (!chatId) return
  enqueue(chatId, async () => {
    const sessionTitle = typeof payload?.title === 'string' ? payload.title : undefined
    getOrCreateStreamingCard(chatId, turnId || undefined, sessionTitle)
    if (typeof payload.text === 'string' && payload.text) {
      await handleServerMessage(chatId, { type: 'content_delta', text: payload.text })
    }
    const delivered = await handleServerMessage(chatId, { type: 'message_complete' })
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
    const message = typeof payload.message === 'string' ? payload.message : 'Moss 会话处理失败。'
    const runtime = getRuntimeState(chatId)
    runtime.state = 'idle'
    runtime.verb = undefined
    let delivered = await abortStreamingCard(chatId, new Error(message))
    if (!delivered) {
      delivered = Boolean(await sendText(chatId, `❌ ${message}`, undefined, turnId || undefined))
    }
    if (delivered && turnId) {
      await desktopBridge.request('turn.delivery.ack', { turnId, chatId })
    }
  })
})

desktopBridge.on('notification.deliver', (payload: any) => {
  const chatId = typeof payload?.chatId === 'string' ? payload.chatId : ''
  const deliveryId = typeof payload?.deliveryId === 'string' ? payload.deliveryId : ''
  if (!chatId || !deliveryId) return
  enqueue(chatId, async () => {
    try {
      const messageId = await sendCard(chatId, buildNotificationCard(payload), deliveryId)
      if (!messageId) throw new Error('Feishu returned no message id.')
      if (typeof payload.decisionRequestId === 'string') {
        const entries = decisionMessages.get(payload.decisionRequestId) || []
        entries.push({
          chatId,
          messageId,
          title: String(payload.title || 'Moss 待确认'),
          summary: String(payload.summary || ''),
        })
        decisionMessages.set(payload.decisionRequestId, entries)
      }
      await desktopBridge.request('delivery.ack', {
        deliveryId,
        ok: true,
        messageId,
      })
    } catch (error) {
      await desktopBridge.request('delivery.ack', {
        deliveryId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {})
    }
  })
})

desktopBridge.on('decision.resolved', (payload: any) => {
  const decisionId = typeof payload?.decision?.id === 'string' ? payload.decision.id : ''
  const status = typeof payload?.decision?.status === 'string' ? payload.decision.status : 'expired'
  const entries = decisionMessages.get(decisionId) || []
  for (const delivery of Array.isArray(payload?.deliveries) ? payload.deliveries : []) {
    if (!delivery?.externalMessageId || entries.some((entry) => entry.messageId === delivery.externalMessageId)) continue
    entries.push({
      chatId: String(delivery.chatId || ''),
      messageId: String(delivery.externalMessageId),
      title: String(payload?.decision?.mobileTitle || 'Moss 待确认'),
      summary: String(payload?.decision?.mobileSummary || ''),
    })
  }
  decisionMessages.delete(decisionId)
  for (const entry of entries) {
    void (larkClient as any).im.message.patch({
      path: { message_id: entry.messageId },
      data: { content: JSON.stringify(buildResolvedNotificationCard(entry, status)) },
    }).catch((error: unknown) => {
      console.error('[Feishu] Unable to update resolved decision card:', error)
    })
  }
})

// ---------- message helpers ----------

function isBotMentioned(mentions?: Array<{ id?: { open_id?: string } }>): boolean {
  if (!mentions || !botOpenId) return false
  return mentions.some((m) => m.id?.open_id === botOpenId)
}

function stripMentions(text: string): string {
  return text.replace(/@_user_\d+/g, '').trim()
}

// ---------- event handlers ----------

async function handleMessage(data: any): Promise<void> {
  const event = data as {
    sender?: { sender_id?: { open_id?: string } }
    message?: {
      message_id?: string
      chat_id?: string
      chat_type?: string
      content?: string
      message_type?: string
      mentions?: Array<{ id?: { open_id?: string }; name?: string }>
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

  // 只处理私聊
  if (chatType === 'p2p') {
    if (!isAllowedUser(senderOpenId)) {
      // 尝试配对
      const pairText = extractInboundPayload(content, msgType).text.trim() || null
      if (pairText) {
        const result = desktopBridge.available
          ? await desktopBridge.request('pairing.attempt', {
            chatId,
            openId: senderOpenId,
            eventId: messageId,
            code: pairText,
            displayName: 'Feishu User',
          }).catch((error) => {
            console.error('[Feishu] Unable to pair with Moss Desktop:', error)
            return { paired: false }
          }) as { paired?: boolean; alreadyPaired?: boolean; duplicate?: boolean }
          : { paired: false, alreadyPaired: false, duplicate: false }
        if (result.duplicate) {
          if (result.paired) await sendText(chatId, '已完成配对，可以继续发送消息。')
          return
        }
        if (result.paired) {
          appAuthorizedUsers.add(senderOpenId)
          if (!result.alreadyPaired) {
            await sendText(chatId, '配对成功，可以从会话中心选择工作内容。')
            await showSessionCenter({ chatId, openId: senderOpenId })
          } else {
            await handleDesktopChatInput({
              chatId,
              openId: senderOpenId,
              eventId: messageId,
              text: pairText,
              hasAttachments: false,
            })
          }
        } else {
          await sendText(chatId, '🔒 未授权。请在 Claude Code 桌面端生成配对码后发送给我。')
        }
      }
      return
    }
  } else {
    // 群聊不处理
    return
  }

  const payload = extractInboundPayload(content, msgType)
  const msgText = stripMentions(payload.text || '')
  const pendingDownloads = payload.pendingDownloads
  const hasAttachments = pendingDownloads.length > 0

  // Allow empty text only when attachments are present
  // (image-only / file-only message)
  if (!msgText && !hasAttachments) return

  // Capture messageId in a non-nullable const before entering the enqueue
  // closure so the downloadResource call below doesn't need a `!` assertion.
  // The early-return guard at the top of handleMessage already proved it
  // non-undefined, but TS doesn't track that across the async closure.
  const safeMessageId = messageId

  // All user input (commands + normal chat) goes through a single per-chat
  // serial queue. Without this, rapidly-fired commands could have their
  // async bodies interleave at `await` points, causing reply messages
  // (e.g. "🧹 已清空..." after "✅ 已新建...") to appear in the wrong order.
  enqueue(chatId, async () => {
    if (!desktopBridge.available) {
      await sendText(chatId, 'Moss 客户端连接已断开，请启动或重启 Moss 后再试。')
      return
    }
    try {
      await handleDesktopChatInput({
        chatId,
        openId: senderOpenId,
        eventId: safeMessageId,
        text: msgText,
        hasAttachments,
      })
    } catch (error) {
      console.error('[Feishu] Moss Desktop request failed:', error)
      await abortStreamingCard(chatId, new Error('Moss 客户端处理失败，请在桌面端查看详情后重试。'))
      await sendText(chatId, 'Moss 客户端处理失败，请在桌面端查看详情后重试。')
    }
  })
}

async function handleCardAction(data: any): Promise<any> {
  const event = data as {
    operator?: { open_id?: string }
    action?: {
      value?: {
        action?: string
        requestId?: string
        allowed?: boolean
        rule?: string
        realPath?: string
        projectName?: string
        sessionId?: string
        actionToken?: string
        decisionId?: string
        category?: string
        page?: number | string
        query?: string
      }
      form_value?: { query?: string }
    }
    context?: { open_chat_id?: string }
    event_id?: string
  }

  const value = event.action?.value || {}
  const action = value.action
  const chatId = event.context?.open_chat_id
  const operatorOpenId = event.operator?.open_id
  if (!chatId || !operatorOpenId) return
  if (!isAllowedUser(operatorOpenId)) {
    return { toast: { type: 'error', content: '当前飞书用户未与 Moss 配对' } }
  }

  if (desktopBridge.available && (action === 'session_center' || action === 'session_page')) {
    const requestedPage = Number.parseInt(String(value.page ?? 0), 10)
    await showSessionCenter({
      chatId,
      openId: operatorOpenId,
      category: normalizeSessionCenterCategory(value.category),
      page: Number.isFinite(requestedPage) ? requestedPage : 0,
      query: typeof value.query === 'string' ? value.query : '',
    })
    return { toast: { type: 'success', content: '会话列表已更新' } }
  }

  if (desktopBridge.available && action === 'search_sessions') {
    await sendCard(chatId, buildSessionSearchCard(normalizeSessionCenterCategory(value.category)))
    return { toast: { type: 'success', content: '请输入搜索关键词' } }
  }

  if (desktopBridge.available && action === 'submit_session_search') {
    const query = String(event.action?.form_value?.query || '').trim()
    await showSessionCenter({
      chatId,
      openId: operatorOpenId,
      category: normalizeSessionCenterCategory(value.category),
      query,
    })
    return { toast: { type: 'success', content: query ? '已完成搜索' : '已显示全部会话' } }
  }

  if (desktopBridge.available && action === 'new_session') {
    const result = await desktopBridge.request('conversation.new', {
      ...desktopIdentity(chatId, operatorOpenId, event.event_id),
      title: '',
    }) as { session?: DesktopSessionOption }
    if (result.session) await sendCard(chatId, buildSessionSelectedCard(result.session))
    return { toast: { type: 'success', content: '已创建新会话' } }
  }

  if (desktopBridge.available && action === 'pick_session') {
    const sessionId = value.sessionId
    if (!sessionId) return
    const result = await desktopBridge.request('conversation.select', {
      ...desktopIdentity(chatId, operatorOpenId, event.event_id),
      sessionId,
    }) as { session?: DesktopSessionOption }
    if (result.session) await sendCard(chatId, buildSessionSelectedCard(result.session))
    return { toast: { type: 'success', content: '已切换会话' } }
  }

  if (desktopBridge.available && action === 'decision') {
    const decisionId = event.action?.value?.decisionId
    const actionToken = event.action?.value?.actionToken
    const allowed = event.action?.value?.allowed ?? false
    if (!decisionId || !actionToken) return
    try {
      await desktopBridge.request('decision.respond', {
        ...desktopIdentity(chatId, operatorOpenId, event.event_id),
        decisionId,
        actionToken,
        allowed,
      })
      return { toast: { type: 'success', content: allowed ? '已允许' : '已拒绝' } }
    } catch (error) {
      console.error('[Feishu] Decision response failed:', error)
      return {
        toast: {
          type: 'error',
          content: '请求已处理、失效或无法执行，请在 Moss 桌面端查看',
        },
      }
    }
  }

  if (action === 'permit' || action === 'pick_project') {
    return { toast: { type: 'error', content: '旧版卡片已失效，请重新发送消息获取当前操作卡片' } }
  }
}

async function handleBotMenu(data: any): Promise<void> {
  const eventKey = typeof data?.event_key === 'string' ? data.event_key.trim() : ''
  const openId = data?.operator?.operator_id?.open_id || data?.operator?.open_id
  const eventId = typeof data?.event_id === 'string' ? data.event_id : undefined
  if (!eventKey || typeof openId !== 'string' || !openId) return

  if (!isAllowedUser(openId)) {
    await sendTextTo(openId, 'open_id', '当前飞书用户还没有与 Moss 配对。请先向机器人发送桌面端生成的配对码。')
    return
  }
  if (!desktopBridge.available) {
    await sendTextTo(openId, 'open_id', 'Moss 客户端当前未连接，请启动客户端后重试。')
    return
  }

  const aliases: Record<string, string> = {
    sessions: FEISHU_MENU_KEYS.sessions,
    new_session: FEISHU_MENU_KEYS.newSession,
    current: FEISHU_MENU_KEYS.current,
    stop: FEISHU_MENU_KEYS.stop,
  }
  const action = aliases[eventKey] || eventKey
  try {
    if (action === FEISHU_MENU_KEYS.sessions || action === FEISHU_MENU_KEYS.current) {
      await showSessionCenter({
        openId,
        receiveId: openId,
        receiveIdType: 'open_id',
      })
      return
    }
    if (action === FEISHU_MENU_KEYS.newSession) {
      const result = await desktopBridge.request('conversation.new', { openId, eventId, title: '' }) as {
        session?: DesktopSessionOption
      }
      if (result.session) {
        await sendCardTo(openId, 'open_id', buildSessionSelectedCard(result.session))
      }
      return
    }
    if (action === FEISHU_MENU_KEYS.stop) {
      const result = await desktopBridge.request('session.abort', { openId, eventId }) as { cancelled?: number }
      await sendTextTo(openId, 'open_id', result.cancelled
        ? `已停止当前执行，并取消 ${result.cancelled} 条排队消息。`
        : '已发送停止信号。')
    }
  } catch (error) {
    console.error('[Feishu] Bot menu action failed:', error)
    await sendTextTo(openId, 'open_id', '请先向 Moss 机器人发送一条消息，再使用会话菜单。')
  }
}

// ---------- resolve bot identity ----------

async function resolveBotOpenId(retries = 3): Promise<void> {
  // Feishu has no "me" user_id literal — use /open-apis/bot/v3/info to fetch
  // the bot's identity via tenant_access_token. Response shape:
  //   { code: 0, msg: 'ok', bot: { open_id: 'ou_xxx', ... } }
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await (larkClient as any).request({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
      })
      const openId = resp?.bot?.open_id ?? resp?.data?.bot?.open_id ?? null
      if (openId) {
        botOpenId = openId
        console.log(`[Feishu] Bot open_id: ${botOpenId}`)
        return
      }
    } catch (err) {
      if (i < retries - 1) {
        console.warn(
          `[Feishu] Could not resolve bot open_id, retrying (${i + 1}/${retries})...`,
          err instanceof Error ? err.message : err,
        )
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
      }
    }
  }
  console.warn('[Feishu] Could not resolve bot open_id (group @mention check may not work)')
}

// ---------- start ----------

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
    'im.message.receive_v1': async (data: any) => {
      try {
        await handleMessage(data)
      } catch (err) {
        console.error('[Feishu] Message handler error:', err)
      }
    },
    'card.action.trigger': async (data: any) => {
      try {
        return await handleCardAction(data)
      } catch (err) {
        console.error('[Feishu] Card action error:', err)
      }
    },
    'application.bot.menu_v6': async (data: any) => {
      try {
        await handleBotMenu(data)
      } catch (err) {
        console.error('[Feishu] Bot menu handler error:', err)
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
  void resolveBotOpenId()
}

start().catch((err) => {
  console.error('[Feishu] Failed to start:', err)
  if (desktopBridge instanceof AppChannelBridge) desktopBridge.fail(err)
  process.exit(1)
})

function shutdown(exitProcess = true, destroyHostBridge = true): void {
  console.log('[Feishu] Shutting down...')
  wsClient?.close({ force: true })
  if (destroyHostBridge) desktopBridge.destroy()
  bridge?.destroy()
  dedup.destroy()
  if (exitProcess) process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
