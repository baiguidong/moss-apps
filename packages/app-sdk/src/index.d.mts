export type AppTarget = 'desktop' | 'server'
export type AppBackendLifecycle = 'on-demand' | 'persistent'
export type AppInstanceMode = 'single' | 'multiple'
export type AppBackendProtocol = string

export type ChannelPermission =
  | 'channel:connection'
  | 'channel:pairing'
  | 'channel:sessions:read'
  | 'channel:sessions:write'
  | 'channel:messages'
  | 'channel:deliveries'
  | 'channel:notifications'
  | 'channel:decisions'

export type ChannelHostMethod =
  | 'connection.update'
  | 'pairing.attempt'
  | 'conversation.list'
  | 'conversation.current'
  | 'conversation.create'
  | 'conversation.select'
  | 'session.abort'
  | 'message.receive'
  | 'delivery.ack'
  | 'decision.respond'

export type ChannelBackendEvent =
  | 'turn.accepted'
  | 'turn.output'
  | 'turn.completed'
  | 'turn.failed'
  | 'notification.deliver'
  | 'decision.resolved'

export interface ChannelExternalIdentity {
  externalUserId: string
  externalConversationId?: string
  externalEventId?: string
}

export type ChannelIdempotentIdentity = ChannelExternalIdentity & { externalEventId: string }

export interface ChannelSessionSummary {
  id: string
  title: string
  preview?: string
  updatedAt: number
  busy: boolean
  projectName?: string | null
  originChannel?: string
}

export interface ChannelAttachment {
  type: 'file' | 'image'
  name?: string
  mimeType?: string
  data?: string
  path?: string
}

export interface ChannelHostRequestMap {
  'connection.update': { connected: boolean; error?: string | null; metadata?: Record<string, unknown> }
  'pairing.attempt': Required<ChannelExternalIdentity> & { code: string; displayName?: string }
  'conversation.list': ChannelExternalIdentity & { category?: string; page?: number; pageSize?: number; query?: string }
  'conversation.current': ChannelExternalIdentity
  'conversation.create': ChannelIdempotentIdentity & { title?: string }
  'conversation.select': ChannelIdempotentIdentity & { sessionId: string }
  'session.abort': ChannelIdempotentIdentity
  'message.receive': Required<ChannelExternalIdentity> & { text?: string; attachments?: ChannelAttachment[] }
  'delivery.ack': {
    deliveryId: string
    kind?: 'turn' | 'notification'
    ok: boolean
    externalConversationId?: string
    externalMessageId?: string
    externalCardId?: string
    error?: string
  }
  'decision.respond': Required<ChannelExternalIdentity> & { decisionId: string; actionToken: string; allowed: boolean }
}

export interface ChannelHostResultMap {
  'connection.update': Record<string, unknown>
  'pairing.attempt': {
    paired: boolean
    alreadyPaired?: boolean
    duplicate?: boolean
    conversationId?: string | null
  }
  'conversation.list': { sessions: ChannelSessionSummary[]; currentSession?: ChannelSessionSummary | null; [key: string]: unknown }
  'conversation.current': { session?: ChannelSessionSummary | null; [key: string]: unknown }
  'conversation.create': { session: ChannelSessionSummary; [key: string]: unknown }
  'conversation.select': { session: ChannelSessionSummary; [key: string]: unknown }
  'session.abort': { cancelled?: number; [key: string]: unknown }
  'message.receive': { accepted?: boolean; duplicate?: boolean; turnId?: string | null; session?: ChannelSessionSummary; [key: string]: unknown }
  'delivery.ack': Record<string, unknown>
  'decision.respond': Record<string, unknown>
}

export interface ChannelBackendEventMap {
  'turn.accepted': { turnId: string; externalConversationId: string; [key: string]: unknown }
  'turn.output': { turnId: string; externalConversationId: string; [key: string]: unknown }
  'turn.completed': { turnId: string; externalConversationId: string; [key: string]: unknown }
  'turn.failed': { turnId: string; externalConversationId: string; [key: string]: unknown }
  'notification.deliver': { deliveryId: string; externalConversationId: string; [key: string]: unknown }
  'decision.resolved': { decisionId: string; [key: string]: unknown }
}

export interface ChannelEventContext extends AppBackendContext {
  channel: AppChannelApi
  signal: AbortSignal
  eventId: string
  name: ChannelBackendEvent
  protocol: 'moss.channel/v1'
}

export type ChannelEventHandler<Data = Record<string, unknown>, Result = unknown> =
  (data: Data, context: ChannelEventContext) => Result | Promise<Result>

export interface AppChannelApi {
  request<Method extends ChannelHostMethod>(
    method: Method,
    input: ChannelHostRequestMap[Method],
    options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ChannelHostResultMap[Method]>
  on<Name extends ChannelBackendEvent, Result = unknown>(
    name: Name,
    handler: ChannelEventHandler<ChannelBackendEventMap[Name], Result>,
  ): () => void
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
    targets: AppTarget[]
    protocols?: AppBackendProtocol[]
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
  protocols: AppBackendProtocol[]
  permissions: string[]
  grants: string[]
  host: AppHostApi
  channel: AppChannelApi
}

export interface AppActionContext extends AppBackendContext {
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
  requestChannelHost<Method extends ChannelHostMethod>(method: Method, input: ChannelHostRequestMap[Method], options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<ChannelHostResultMap[Method]>
  onChannelEvent<Name extends ChannelBackendEvent, Result = unknown>(name: Name, handler: ChannelEventHandler<ChannelBackendEventMap[Name], Result>): () => void
  requestHost<Output = unknown>(protocol: AppBackendProtocol, method: string, input?: Record<string, unknown>, options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<Output>
  onHostEvent<Result = unknown>(protocol: AppBackendProtocol, name: string, handler: (data: Record<string, unknown>, context: HostEventContext) => Result | Promise<Result>): () => void
  readonly host: AppHostApi
  readonly channel: AppChannelApi
  emit(name: string, data?: unknown): void
  log(level: string, message: string, details?: unknown): void
  status(state: string, details?: unknown): void
  start(actions?: Record<string, AppActionHandler>): this
  handleMessage(raw: unknown): Promise<void>
}

export const APP_SERVICE_PROTOCOL_VERSION: 1
export const APP_BACKEND_API_VERSION: 1
export const MOSS_CHANNEL_PROTOCOL: 'moss.channel/v1'
export const CHANNEL_PERMISSIONS: Readonly<Record<string, ChannelPermission>>
export const CHANNEL_HOST_METHOD_PERMISSIONS: Readonly<Record<ChannelHostMethod, ChannelPermission>>
export const CHANNEL_BACKEND_EVENT_PERMISSIONS: Readonly<Record<ChannelBackendEvent, ChannelPermission>>
export const CHANNEL_HOST_METHODS: readonly ChannelHostMethod[]
export const CHANNEL_BACKEND_EVENTS: readonly ChannelBackendEvent[]
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
export function validateChannelHostMethod(value: unknown): ChannelHostMethod
export function validateChannelBackendEvent(value: unknown): ChannelBackendEvent
export function getChannelHostMethodPermission(method: ChannelHostMethod): ChannelPermission
export function getChannelBackendEventPermission(name: ChannelBackendEvent): ChannelPermission
export function validateChannelProtocol(value: unknown): 'moss.channel/v1'
export function validateChannelData(value: unknown, label?: string): Record<string, unknown>
export function validateChannelHostInput(method: ChannelHostMethod, value: unknown): Record<string, unknown>
export function validateChannelBackendEventData(name: ChannelBackendEvent, value: unknown): Record<string, unknown>
export function requireChannelPermission(permissions: string[], requiredPermission: ChannelPermission): true
export function validateHostProtocol(value: unknown): string
export function validateHostMember(value: unknown, label?: string): string
export function validateHostData(value: unknown, label?: string): Record<string, unknown>
export function requireHostProtocol(protocols: string[], protocol: string): true
export function requireHostPermission(permissions: string[], requiredPermission?: string | null, options?: { source?: 'declaration' | 'grant' }): true
export function ensureSafeRelativePath(value: unknown, fieldName?: string): string
export function validateAppManifest(rawManifest: unknown, options?: { hostApiVersion?: string }): AppManifestV2
export function loadJsonSchema(packageRoot: string, relativePath: string, fieldName?: string): Record<string, unknown>
export function compileJsonSchema(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown[] }

export function createBackendTestHarness(actions?: Record<string, AppActionHandler>): {
  client: AppBackendClient
  received: AppServiceEnvelope[]
  host: unknown
  send(message: AppServiceEnvelope): void
}
