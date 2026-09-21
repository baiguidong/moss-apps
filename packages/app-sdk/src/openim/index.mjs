import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'
import {
  openIMDefaultConversationId,
  parseOpenIMDirectConversationId,
} from './identifiers.mjs'

export {
  openIMConversationScope,
  openIMDefaultConversationId,
  openIMDirectConversationId,
  parseOpenIMDirectConversationId,
  openIMDefaultConversationIdFor,
} from './identifiers.mjs'

export const MOSS_OPENIM_PROTOCOL = 'moss.openim/v1'

export const OPENIM_PERMISSIONS = Object.freeze({
  client: 'openim:client',
  messages: 'openim:messages',
})

export const OPENIM_HOST_METHOD_PERMISSIONS = Object.freeze({
  'session.ensure': OPENIM_PERMISSIONS.client,
  'message.send': OPENIM_PERMISSIONS.messages,
})

export const OPENIM_BACKEND_EVENT_PERMISSIONS = Object.freeze({
  'message.received': OPENIM_PERMISSIONS.messages,
  'session.changed': OPENIM_PERMISSIONS.client,
})

export const OPENIM_HOST_METHODS = Object.freeze(Object.keys(OPENIM_HOST_METHOD_PERMISSIONS))
export const OPENIM_BACKEND_EVENTS = Object.freeze(Object.keys(OPENIM_BACKEND_EVENT_PERMISSIONS))

function fail(message) {
  throw new AppServiceError(APP_ERROR_CODES.invalidInput, message)
}

function record(value, label) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function rejectUnknownFields(input, allowedFields, label) {
  const allowed = new Set(allowedFields)
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) fail(`${label} contains an unknown field: ${field}`)
  }
}

function text(input, field, label, { optional = false, maxLength = 512 } = {}) {
  const value = input[field]
  if (optional && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    fail(`${label} has an invalid ${field}`)
  }
  return value.trim()
}

function known(value, entries, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || !Object.hasOwn(entries, normalized)) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `Unknown ${MOSS_OPENIM_PROTOCOL} ${label}: ${normalized || '<empty>'}`)
  }
  return normalized
}

export function validateOpenIMHostMethod(value) {
  return known(value, OPENIM_HOST_METHOD_PERMISSIONS, 'Host method')
}

export function validateOpenIMBackendEvent(value) {
  return known(value, OPENIM_BACKEND_EVENT_PERMISSIONS, 'Backend event')
}

export function validateOpenIMHostInput(method, value) {
  const normalizedMethod = validateOpenIMHostMethod(method)
  const input = record(value, `${normalizedMethod} input`)
  for (const field of ['appId', 'instanceId', 'owner', 'principal']) {
    if (Object.hasOwn(input, field)) fail(`${normalizedMethod} cannot override Runtime identity: ${field}`)
  }
  if (normalizedMethod === 'session.ensure') {
    rejectUnknownFields(input, [], normalizedMethod)
    return {}
  }
  rejectUnknownFields(input, [
    'recipientId', 'conversationId', 'text', 'idempotencyKey',
  ], normalizedMethod)
  const recipientId = text(input, 'recipientId', normalizedMethod)
  const conversationId = text(input, 'conversationId', normalizedMethod)
  const conversation = parseOpenIMDirectConversationId(conversationId)
  if (!conversation || conversation.peerUserId !== recipientId) {
    fail('message.send conversationId does not match recipientId')
  }
  return {
    recipientId,
    conversationId,
    text: text(input, 'text', normalizedMethod, { maxLength: 100_000 }),
    idempotencyKey: text(input, 'idempotencyKey', normalizedMethod, { maxLength: 256 }),
  }
}

export function validateOpenIMBackendEventData(name, value) {
  const normalizedName = validateOpenIMBackendEvent(name)
  const data = record(value, `${normalizedName} data`)
  if (normalizedName === 'session.changed') {
    rejectUnknownFields(data, ['connected', 'userId', 'error', 'expiresIn'], normalizedName)
    if (typeof data.connected !== 'boolean') fail('session.changed requires connected')
    return {
      connected: data.connected,
      userId: text(data, 'userId', normalizedName, { optional: true }),
      error: text(data, 'error', normalizedName, { optional: true, maxLength: 2_000 }),
      ...(Number.isFinite(data.expiresIn) ? { expiresIn: Math.max(0, Math.floor(data.expiresIn)) } : {}),
    }
  }
  rejectUnknownFields(data, [
    'externalUserId', 'externalConversationId', 'externalEventId',
    'text', 'sentAt', 'contentType', 'sessionType',
  ], normalizedName)
  const sentAt = Number(data.sentAt)
  const contentType = Number(data.contentType)
  const sessionType = Number(data.sessionType)
  if (!Number.isFinite(sentAt) || sentAt < 0) fail('message.received has an invalid sentAt')
  if (!Number.isInteger(contentType) || contentType < 0) fail('message.received has an invalid contentType')
  if (!Number.isInteger(sessionType) || sessionType < 0) fail('message.received has an invalid sessionType')
  return {
    externalUserId: text(data, 'externalUserId', normalizedName),
    externalConversationId: text(data, 'externalConversationId', normalizedName),
    externalEventId: text(data, 'externalEventId', normalizedName),
    text: text(data, 'text', normalizedName, { maxLength: 100_000 }),
    sentAt,
    contentType,
    sessionType,
  }
}
