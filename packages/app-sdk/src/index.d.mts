/** A supported Backend placement. Manifest targets must explicitly contain desktop, server, or both. */
export type AppTarget = 'desktop' | 'server'
export type AppBackendLifecycle = 'on-demand' | 'persistent'
export type AppInstanceMode = 'single' | 'multiple'
export type AppOwnerScope = 'host' | 'org' | 'user'
export interface AppOwner {
  scope: AppOwnerScope
  orgId: string | null
  userId: string | null
  key: string
}
export type AppBackendProtocol = string
export type AppTargetProtocols = Partial<Record<AppTarget, AppBackendProtocol[]>>

export interface AgentSessionSummary {
  id: string
  title: string
  preview?: string
  updatedAt: number
  busy: boolean
  projectName?: string | null
  originChannel?: string
}

export interface AgentAttachment {
  type: 'file' | 'image'
  name?: string
  mimeType?: string
  data?: string
  path?: string
}

export type AccountPermission = 'account:identity:read' | 'account:directory:read'
export type AccountHostMethod = 'identity.current' | 'directory.list' | 'directory.search'
export type AccountBackendEvent = 'directory.changed' | 'directory.user-changed'
export interface AccountBackendEventMap {
  'directory.changed': { revision?: string }
  'directory.user-changed': { user: AccountDirectoryUser }
}

export interface AccountDirectoryInput {
  departmentId?: string
  cursor?: string
  limit?: number
}

export interface AccountDirectoryUser {
  id: string
  name: string
  email?: string | null
  departmentId?: string | null
  status?: string
}

export interface AccountDirectoryDepartment {
  id: string
  name: string
  parentId?: string | null
  userCount?: number
}

export interface AccountHostRequestMap {
  'identity.current': Record<string, never>
  'directory.list': AccountDirectoryInput
  'directory.search': Omit<AccountDirectoryInput, 'cursor'> & { query: string }
}

export interface AccountHostResultMap {
  'identity.current': {
    user: AccountDirectoryUser | null
    organization?: { id: string; name: string } | null
    scopes?: string[]
    source: 'local' | 'server'
  }
  'directory.list': {
    users: AccountDirectoryUser[]
    departments: AccountDirectoryDepartment[]
    nextCursor?: string | null
    revision?: string
  }
  'directory.search': AccountHostResultMap['directory.list']
}

export interface AppAccountApi {
  request<Method extends AccountHostMethod>(
    method: Method,
    input?: AccountHostRequestMap[Method],
    options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<AccountHostResultMap[Method]>
  on<Event extends AccountBackendEvent>(
    name: Event,
    handler: (data: AccountBackendEventMap[Event], context: HostEventContext) => unknown | Promise<unknown>,
  ): () => void
}

export type AgentPermission =
  | 'agent:catalog:read'
  | 'agent:bindings:read'
  | 'agent:bindings:write'
  | 'agent:sessions:read'
  | 'agent:sessions:write'
  | 'agent:turns:read'
  | 'agent:turns:write'

export type AgentReplyMode = 'human_only' | 'ai_auto' | 'ai_draft_review' | 'mention_only' | 'inherit'
export type AgentSessionMode = 'fixed' | 'rotating' | 'new_each_turn'
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'dontAsk'
export type AgentCatalogKind = 'agents' | 'tools' | 'skills' | 'connectors'
export type AgentHostMethod =
  | 'catalog.list'
  | 'binding.get'
  | 'binding.update'
  | 'binding.reset'
  | 'session.list'
  | 'session.current'
  | 'session.create'
  | 'session.select'
  | 'session.abort'
  | 'context.observe'
  | 'turn.start'
  | 'turn.list'
  | 'turn.get'
  | 'turn.abort'
  | 'turn.reply'
  | 'turn.review'
  | 'turn.delivery.ack'
export type AgentBackendEvent =
  | 'binding.changed'
  | 'turn.accepted'
  | 'turn.review_requested'
  | 'turn.completed'
  | 'turn.failed'

export interface AgentBindingResources {
  tools: string[] | null
  skills: string[] | null
  connectors: string[] | null
}

export interface AgentBindingPolicy {
  inheritDefault?: boolean
  replyMode: AgentReplyMode
  agentId: string | null
  permissionMode: AgentPermissionMode
  resources: AgentBindingResources
  session: { mode: AgentSessionMode; rotateAfterTurns: number }
  proactive: { enabled: boolean; maxConsecutiveReplies: number; cooldownMs: number }
}

export interface AgentBindingPatch {
  inheritDefault?: boolean
  replyMode?: AgentReplyMode
  agentId?: string | null
  permissionMode?: AgentPermissionMode | null
  resources?: Partial<AgentBindingResources> | null
  session?: Partial<AgentBindingPolicy['session']> | null
  proactive?: Partial<AgentBindingPolicy['proactive']> | null
}

export interface AgentBindingRecord {
  appId: string
  instanceId: string
  externalConversationId: string
  externalMemberId: string | null
  policy: AgentBindingPatch
  revision: number
  createdAt: number
  updatedAt: number
}

export interface AgentEffectiveBinding extends AgentBindingPolicy {
  appId: string
  instanceId: string
  externalConversationId: string
  externalMemberId: string | null
  revision: number
  sourceRevisions: { instance: number; conversation: number; instanceMember: number; member: number }
  inherited?: boolean
}

export interface AgentHostRequestMap {
  'catalog.list': { kinds?: AgentCatalogKind[] }
  'binding.get': { externalConversationId: string; externalMemberId?: string; defaultConversationId?: string }
  'binding.update': {
    externalConversationId: string
    externalMemberId?: string
    defaultConversationId?: string
    expectedRevision?: number
    patch: AgentBindingPatch
  }
  'binding.reset': {
    externalConversationId: string
    externalMemberId?: string
    defaultConversationId?: string
    expectedRevision?: number
  }
  'session.list': {
    externalUserId: string
    externalConversationId?: string
    externalEventId?: string
    category?: string
    page?: number
    pageSize?: number
    query?: string
  }
  'session.current': {
    externalUserId: string
    externalConversationId?: string
    externalEventId?: string
  }
  'session.create': {
    externalUserId: string
    externalConversationId?: string
    externalEventId: string
    title?: string
  }
  'session.select': {
    externalUserId: string
    externalConversationId?: string
    externalEventId: string
    sessionId: string
  }
  'session.abort': {
    externalUserId: string
    externalConversationId?: string
    externalEventId: string
  }
  'context.observe': {
    externalUserId: string
    externalConversationId: string
    externalEventId: string
    text: string
  }
  'turn.start': {
    externalUserId: string
    externalConversationId: string
    externalEventId: string
    defaultConversationId?: string
    text?: string
    attachments?: AgentAttachment[]
    mentioned?: boolean
    source?: 'human' | 'agent' | 'system'
    hop?: number
  }
  'turn.list': {
    externalConversationId?: string
    statuses?: Array<'received' | 'human' | 'queued' | 'running' | 'awaiting_review' | 'completed' | 'rejected' | 'failed' | 'cancelled'>
    limit?: number
  }
  'turn.get': { turnId: string }
  'turn.abort': { turnId: string }
  'turn.reply': { turnId: string; action: 'send' | 'dismiss'; text?: string }
  'turn.review': { turnId: string; action: 'approve' | 'reject'; text?: string }
  'turn.delivery.ack': { turnId: string; externalConversationId: string; ok: boolean; externalMessageId?: string; error?: string }
}

export interface AgentHostResultMap {
  'catalog.list': { agents?: unknown[]; tools?: unknown[]; skills?: unknown[]; connectors?: unknown[] }
  'binding.get': { binding: AgentBindingRecord | null; effective: AgentEffectiveBinding }
  'binding.update': { binding: AgentBindingRecord; effective: AgentEffectiveBinding }
  'binding.reset': { reset: boolean; binding: null; effective: AgentEffectiveBinding }
  'session.list': {
    sessions: AgentSessionSummary[]
    currentSession: AgentSessionSummary | null
    page: number
    pageSize: number
    total: number
    hasPrevious: boolean
    hasNext: boolean
  }
  'session.current': { session: AgentSessionSummary | null }
  'session.create': { session: AgentSessionSummary }
  'session.select': { session: AgentSessionSummary }
  'session.abort': { cancelled: number; session: AgentSessionSummary }
  'context.observe': { observed: boolean; duplicate: boolean }
  'turn.start': Record<string, unknown>
  'turn.list': { turns: Array<Record<string, unknown>> }
  'turn.get': { turn: Record<string, unknown> | null }
  'turn.abort': { turn: Record<string, unknown>; aborted: boolean }
  'turn.reply': { turn: Record<string, unknown> }
  'turn.review': { turn: Record<string, unknown> }
  'turn.delivery.ack': { acknowledged: boolean; turnId: string; status: string }
}

export interface AppAgentApi {
  request<Method extends AgentHostMethod>(
    method: Method,
    input: AgentHostRequestMap[Method],
    options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<AgentHostResultMap[Method]>
  on(
    name: AgentBackendEvent,
    handler: (data: Record<string, unknown>, context: HostEventContext) => unknown | Promise<unknown>,
  ): () => void
}

export type DesktopPermission = 'desktop:files' | 'desktop:screen-capture' | 'desktop:external-links' | 'desktop:media'
export type DesktopHostMethod =
  | 'file.pick'
  | 'file.materialize'
  | 'file.thumbnail'
  | 'file.download'
  | 'screen.capture'
  | 'shell.open-external'

export interface DesktopFile {
  name: string
  path: string
  size: number
  mediaUrl: string
}

export interface DesktopHostRequestMap {
  'file.pick': { kind?: 'image' | 'video' | 'audio' | 'file'; multiple?: boolean }
  'file.materialize': { fileName: string; dataBase64: string; transferId?: string; offset?: number; complete?: boolean }
  'file.thumbnail': { path: string; width?: number; height?: number }
  'file.download': { url: string; fileName: string }
  'screen.capture': Record<string, never>
  'shell.open-external': { url: string }
}

export interface DesktopHostResultMap {
  'file.pick': { files: DesktopFile[] }
  'file.materialize': DesktopFile | { transferId: string; complete: false; size: number }
  'file.thumbnail': { path: string; mediaUrl: string }
  'file.download': { canceled: boolean; filePath?: string }
  'screen.capture': DesktopFile
  'shell.open-external': { opened: true }
}

export interface AppDesktopApi {
  request<Method extends DesktopHostMethod>(
    method: Method,
    input: DesktopHostRequestMap[Method],
    options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<DesktopHostResultMap[Method]>
}

export type OpenIMPermission = 'openim:client'
export type OpenIMHostMethod =
  | 'session.issue'
  | 'directory.list'
  | 'conversation.direct.prepare'
  | 'conversation.group.prepare'

export interface OpenIMHostRequestMap {
  'session.issue': { platformId: number }
  'directory.list': { cursor?: string; limit?: number }
  'conversation.direct.prepare': { userId: string }
  'conversation.group.prepare': { userIds: string[] }
}

export type RemotePermission = 'remote:actions'
export type RemoteHostMethod = 'action.invoke'
export interface RemoteHostRequestMap {
  'action.invoke': { action: string; input?: Record<string, unknown>; timeoutMs?: number; ownerScope?: 'user' | 'org' }
}
export interface RemoteHostResultMap { 'action.invoke': unknown }
/** @deprecated Transitional compatibility only. New Apps must use one active Backend placement. */
export interface AppRemoteApi {
  request<Output = unknown>(
    method: 'action.invoke',
    input: RemoteHostRequestMap['action.invoke'],
    options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<Output>
}

export interface AppHostApi {
  request<Output = unknown>(
    protocol: AppBackendProtocol,
    method: string,
    input?: Record<string, unknown>,
    options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<Output>
  on<Result = unknown>(
    protocol: AppBackendProtocol,
    name: string,
    handler: (data: Record<string, unknown>, context: HostEventContext) => Result | Promise<Result>,
  ): () => void
}

export interface HostEventContext extends AppBackendContext {
  host: AppHostApi
  signal: AbortSignal
  eventId: string
  name: string
  protocol: AppBackendProtocol
}

export interface AppActionManifest {
  name: string
  inputSchema?: string
  outputSchema?: string
  timeoutMs?: number
}

export interface AppManifestV2 {
  schemaVersion: 2
  id: string
  version: string
  displayName: string
  description: string
  icon: string
  hostApi: string
  publisher?: { id: string; name: string }
  ui?: { entry: string; window: { width: number; height: number; resizable: boolean } }
  backend?: {
    entry: string
    runtime: 'node'
    apiVersion: 1
    lifecycle: AppBackendLifecycle
    instanceMode: AppInstanceMode
    /** Owner scope used only while this instance is placed on Server. */
    serverOwnerScope?: 'user' | 'org'
    /** Alternative placements for one Backend; an instance is active on only one target at a time. */
    targets: AppTarget[]
    /** Host protocols used at each target. The array form is transitional and applies to every target. */
    protocols?: AppTargetProtocols | AppBackendProtocol[]
    actions: AppActionManifest[]
    configuration?: { schema?: string; secrets?: string }
  }
  contributes?: {
    views: Array<Record<string, any>>
    settings: Array<Record<string, any>>
    commands: Array<Record<string, any>>
    tools: Array<Record<string, any>>
    resourceProviders: Array<Record<string, any>>
    widgets: Array<Record<string, any>>
  }
  permissions: string[]
}

export interface AppServiceEnvelope<T = unknown> {
  version: 1
  id: string
  type: string
  timestamp: number
  payload: T
}

export interface AppBackendContext {
  appId: string
  version: string
  instanceId: string
  generation: number
  launchToken: string
  config: Record<string, unknown>
  secrets: Record<string, string>
  dataDir: string
  runtimeDir: string
  target: { type: AppTarget; id: string }
  owner: AppOwner | null
  protocols: AppBackendProtocol[]
  permissions: string[]
  grants: string[]
  host: AppHostApi
  account: AppAccountApi
  agent: AppAgentApi
  desktop: AppDesktopApi
  remote: AppRemoteApi
}

export interface AppActionContext extends AppBackendContext {
  principal: AppOwner | null
  signal: AbortSignal
  requestId: string
  emit(name: string, data?: unknown): void
  log(level: string, message: string, details?: unknown): void
}

export type AppActionHandler<Input = unknown, Output = unknown> =
  (input: Input, context: AppActionContext) => Output | Promise<Output>

export interface AppUiApi {
  app: {
    getInfo(): Promise<Record<string, unknown>>
    getVersions(): Promise<Array<Record<string, unknown>>>
    getInstallationState(): Promise<Record<string, unknown> | null>
  }
  instances: {
    list(): Promise<Array<Record<string, unknown>>>
    create(input?: Record<string, unknown>): Promise<Record<string, unknown>>
    update(instanceId: string, patch?: Record<string, unknown>): Promise<Record<string, unknown>>
    setEnabled(instanceId: string, enabled: boolean): Promise<unknown>
    clearCredentials(instanceId: string): Promise<Record<string, unknown>>
    remove(instanceId: string, options?: { deleteData?: boolean; deleteCredentials?: boolean }): Promise<{ ok: true }>
    getStatus(instanceId: string): Promise<Array<Record<string, unknown>>>
  }
  actions: {
    invoke<Output = unknown>(instanceId: string, name: string, input?: unknown, options?: { requestId?: string; timeoutMs?: number }): Promise<Output>
    cancel(instanceId: string, requestId: string): Promise<{ canceled: boolean }>
  }
  storage: {
    getItem<T = unknown>(key: string): Promise<T | undefined>
    setItem(key: string, value: unknown): Promise<{ ok: true; key: string }>
    removeItem(key: string): Promise<{ ok: true; key: string }>
    list(): Promise<string[]>
  }
  host: {
    request<Output = unknown>(instanceId: string, protocol: AppBackendProtocol, method: string, input?: Record<string, unknown>): Promise<Output>
  }
  events: {
    on(eventName: string, callback: (payload: unknown) => void): () => void
  }
}

export class AppServiceError extends Error {
  code: string
  details?: unknown
  constructor(code: string, message: string, details?: unknown)
}

export class AppBackendClient {
  constructor(options?: Record<string, unknown>)
  registerAction(name: string, handler: AppActionHandler): this
  requestAccountHost<Method extends AccountHostMethod>(method: Method, input?: AccountHostRequestMap[Method], options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<AccountHostResultMap[Method]>
  onAccountEvent(name: AccountBackendEvent, handler: (data: Record<string, unknown>, context: HostEventContext) => unknown | Promise<unknown>): () => void
  requestAgentHost<Method extends AgentHostMethod>(method: Method, input: AgentHostRequestMap[Method], options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<AgentHostResultMap[Method]>
  onAgentEvent(name: AgentBackendEvent, handler: (data: Record<string, unknown>, context: HostEventContext) => unknown | Promise<unknown>): () => void
  requestDesktopHost<Method extends DesktopHostMethod>(method: Method, input: DesktopHostRequestMap[Method], options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<DesktopHostResultMap[Method]>
  requestRemoteHost<Output = unknown>(method: 'action.invoke', input: RemoteHostRequestMap['action.invoke'], options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<Output>
  requestHost<Output = unknown>(protocol: AppBackendProtocol, method: string, input?: Record<string, unknown>, options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<Output>
  onHostEvent<Result = unknown>(protocol: AppBackendProtocol, name: string, handler: (data: Record<string, unknown>, context: HostEventContext) => Result | Promise<Result>): () => void
  readonly host: AppHostApi
  readonly account: AppAccountApi
  readonly agent: AppAgentApi
  readonly desktop: AppDesktopApi
  readonly remote: AppRemoteApi
  emit(name: string, data?: unknown): void
  log(level: string, message: string, details?: unknown): void
  status(state: string, details?: unknown): void
  start(actions?: Record<string, AppActionHandler>): this
  handleMessage(raw: unknown): Promise<void>
}

export const APP_SERVICE_PROTOCOL_VERSION: 1
export const APP_BACKEND_API_VERSION: 1
export const MOSS_ACCOUNT_PROTOCOL: 'moss.account/v1'
export const MOSS_AGENT_PROTOCOL: 'moss.agent/v1'
export const MOSS_DESKTOP_PROTOCOL: 'moss.desktop/v1'
export const MOSS_OPENIM_PROTOCOL: 'moss.openim/v1'
/** @deprecated Transitional compatibility only. New Apps must not split a Backend across targets. */
export const MOSS_REMOTE_PROTOCOL: 'moss.remote/v1'
export const ACCOUNT_PERMISSIONS: Readonly<Record<string, AccountPermission>>
export const ACCOUNT_HOST_METHOD_PERMISSIONS: Readonly<Record<AccountHostMethod, AccountPermission>>
export const ACCOUNT_BACKEND_EVENT_PERMISSIONS: Readonly<Record<AccountBackendEvent, AccountPermission>>
export const ACCOUNT_HOST_METHODS: readonly AccountHostMethod[]
export const ACCOUNT_BACKEND_EVENTS: readonly AccountBackendEvent[]
export const AGENT_PERMISSIONS: Readonly<Record<string, AgentPermission>>
export const AGENT_REPLY_MODES: readonly AgentReplyMode[]
export const AGENT_SESSION_MODES: readonly AgentSessionMode[]
export const AGENT_PERMISSION_MODES: readonly AgentPermissionMode[]
export const AGENT_CATALOG_KINDS: readonly AgentCatalogKind[]
export const AGENT_HOST_METHOD_PERMISSIONS: Readonly<Record<AgentHostMethod, AgentPermission>>
export const AGENT_BACKEND_EVENT_PERMISSIONS: Readonly<Record<AgentBackendEvent, AgentPermission>>
export const AGENT_HOST_METHODS: readonly AgentHostMethod[]
export const AGENT_BACKEND_EVENTS: readonly AgentBackendEvent[]
export const DESKTOP_PERMISSIONS: Readonly<Record<string, DesktopPermission>>
export const DESKTOP_HOST_METHOD_PERMISSIONS: Readonly<Record<DesktopHostMethod, DesktopPermission>>
export const DESKTOP_HOST_METHODS: readonly DesktopHostMethod[]
export const OPENIM_PERMISSIONS: Readonly<Record<string, OpenIMPermission>>
export const OPENIM_HOST_METHOD_PERMISSIONS: Readonly<Record<OpenIMHostMethod, OpenIMPermission>>
export const OPENIM_HOST_METHODS: readonly OpenIMHostMethod[]
export const REMOTE_PERMISSIONS: Readonly<Record<string, RemotePermission>>
export const REMOTE_HOST_METHOD_PERMISSIONS: Readonly<Record<RemoteHostMethod, RemotePermission>>
export const REMOTE_HOST_METHODS: readonly RemoteHostMethod[]
export const DEFAULT_MAX_MESSAGE_BYTES: number
export const APP_HOST_API_VERSION: string
export const APP_MANIFEST_SCHEMA: Record<string, unknown>
export const APP_ERROR_CODES: Readonly<Record<string, string>>
export const HOST_MESSAGE_TYPES: readonly string[]
export const BACKEND_MESSAGE_TYPES: readonly string[]

export function defineAppBackend(actions: Record<string, AppActionHandler>, options?: Record<string, unknown>): AppBackendClient
export function createEnvelope<T = unknown>(type: string, payload?: T, options?: { id?: string; timestamp?: number }): AppServiceEnvelope<T>
export function validateEnvelope<T = unknown>(raw: unknown, options?: { allowedTypes?: string[]; maxBytes?: number }): AppServiceEnvelope<T>
export function getEnvelopeByteLength(envelope: unknown): number
export function serializeError(error: unknown, fallbackCode?: string): { code: string; message: string; details?: unknown }
export function validateAccountHostMethod(value: unknown): AccountHostMethod
export function validateAccountBackendEvent(value: unknown): AccountBackendEvent
export function validateAccountHostInput(method: AccountHostMethod, value: unknown): Record<string, unknown>
export function validateAccountHostOutput(method: AccountHostMethod, value: unknown): Record<string, unknown>
export function validateAccountBackendEventData(name: AccountBackendEvent, value: unknown): Record<string, unknown>
export function validateAgentHostMethod(value: unknown): AgentHostMethod
export function validateAgentBackendEvent(value: unknown): AgentBackendEvent
export function validateAgentHostInput(method: AgentHostMethod, value: unknown): Record<string, unknown>
export function validateAgentHostOutput(method: AgentHostMethod, value: unknown): Record<string, unknown>
export function validateAgentBackendEventData(name: AgentBackendEvent, value: unknown): Record<string, unknown>
export function validateAgentAttachments(value: unknown, method: string): void
export function validateAgentMessageContent(input: Record<string, unknown>, method: string): void
export function validateDesktopHostMethod(value: unknown): DesktopHostMethod
export function validateDesktopHostInput(method: DesktopHostMethod, value: unknown): Record<string, unknown>
export function validateDesktopHostOutput(method: DesktopHostMethod, value: unknown): Record<string, unknown>
export function validateOpenIMHostMethod(value: unknown): OpenIMHostMethod
export function validateOpenIMHostInput(method: OpenIMHostMethod, value: unknown): Record<string, unknown>
export function validateOpenIMHostOutput(method: OpenIMHostMethod, value: unknown): Record<string, unknown>
export function validateRemoteHostMethod(value: unknown): RemoteHostMethod
export function validateRemoteHostInput(method: RemoteHostMethod, value: unknown): Record<string, unknown>
export function validateHostProtocol(value: unknown): string
export function validateHostMember(value: unknown, label?: string): string
export function validateHostData(value: unknown, label?: string): Record<string, unknown>
export function requireHostProtocol(protocols: string[], protocol: string): true
export function requireHostPermission(permissions: string[], requiredPermission?: string | null, options?: { source?: 'declaration' | 'grant' }): true
export function ensureSafeRelativePath(value: unknown, fieldName?: string): string
export function validateAppManifest(rawManifest: unknown, options?: { hostApiVersion?: string }): AppManifestV2
export function resolveBackendProtocols(backend: AppManifestV2['backend'], target: AppTarget): AppBackendProtocol[]
export function loadJsonSchema(packageRoot: string, relativePath: string, fieldName?: string): Record<string, unknown>
export function compileJsonSchema(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown[] }

export function createBackendTestHarness(actions?: Record<string, AppActionHandler>): {
  client: AppBackendClient
  received: AppServiceEnvelope[]
  host: unknown
  send(message: AppServiceEnvelope): void
}
