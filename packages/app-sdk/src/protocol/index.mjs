import { randomUUID } from 'node:crypto'

export const APP_SERVICE_PROTOCOL_VERSION = 1
export const APP_BACKEND_API_VERSION = 1
export const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024

export const HOST_MESSAGE_TYPES = Object.freeze([
  'service.init',
  'action.invoke',
  'action.cancel',
  'host.response',
  'host.event',
  'host.event.cancel',
  'service.ping',
  'service.shutdown',
])

export const BACKEND_MESSAGE_TYPES = Object.freeze([
  'service.hello',
  'service.ready',
  'service.status',
  'action.result',
  'action.error',
  'host.request',
  'host.cancel',
  'host.event.response',
  'event.emit',
  'service.pong',
  'log.write',
])

export const APP_ERROR_CODES = Object.freeze({
  invalidManifest: 'APP_INVALID_MANIFEST',
  incompatibleHost: 'APP_INCOMPATIBLE_HOST_API',
  invalidPackage: 'APP_INVALID_PACKAGE',
  integrityFailed: 'APP_INTEGRITY_FAILED',
  disabled: 'APP_DISABLED',
  instanceDisabled: 'APP_INSTANCE_DISABLED',
  actionNotFound: 'APP_ACTION_NOT_FOUND',
  invalidInput: 'APP_INVALID_ACTION_INPUT',
  invalidOutput: 'APP_INVALID_ACTION_OUTPUT',
  actionTimeout: 'APP_ACTION_TIMEOUT',
  actionCanceled: 'APP_ACTION_CANCELED',
  backendUnavailable: 'APP_BACKEND_UNAVAILABLE',
  handshakeFailed: 'APP_HANDSHAKE_FAILED',
  staleGeneration: 'APP_STALE_GENERATION',
  crashLoop: 'APP_CRASH_LOOP',
  unauthorized: 'APP_UNAUTHORIZED',
  permissionDenied: 'APP_PERMISSION_DENIED',
  hostUnavailable: 'APP_HOST_UNAVAILABLE',
  hostTimeout: 'APP_HOST_TIMEOUT',
  hostProtocol: 'APP_HOST_PROTOCOL_ERROR',
})

export class AppServiceError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'AppServiceError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export function createEnvelope(type, payload = {}, options = {}) {
  return {
    version: APP_SERVICE_PROTOCOL_VERSION,
    id: String(options.id || randomUUID()),
    type: String(type),
    timestamp: Number(options.timestamp || Date.now()),
    payload,
  }
}

export function getEnvelopeByteLength(envelope) {
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8')
}

export function validateEnvelope(raw, options = {}) {
  const allowedTypes = options.allowedTypes || [...HOST_MESSAGE_TYPES, ...BACKEND_MESSAGE_TYPES]
  const maxBytes = Number(options.maxBytes) || DEFAULT_MAX_MESSAGE_BYTES
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'Protocol message must be an object')
  }
  if (raw.version !== APP_SERVICE_PROTOCOL_VERSION) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, `Unsupported protocol version: ${raw.version}`)
  }
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 128) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'Protocol message id is invalid')
  }
  if (!allowedTypes.includes(raw.type)) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, `Unknown protocol message type: ${raw.type}`)
  }
  if (!Number.isFinite(raw.timestamp) || raw.timestamp <= 0) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'Protocol timestamp is invalid')
  }
  if (getEnvelopeByteLength(raw) > maxBytes) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'Protocol message exceeds the size limit')
  }
  return raw
}

export function serializeError(error, fallbackCode = APP_ERROR_CODES.backendUnavailable) {
  return {
    code: String(error?.code || fallbackCode),
    message: String(error?.message || error || 'Unknown App Backend error'),
    details: error?.details,
  }
}
