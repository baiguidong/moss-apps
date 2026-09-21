import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'

export const MOSS_CHANNEL_PROTOCOL = 'moss.channel/v1'

export const CHANNEL_PERMISSIONS = Object.freeze({
  connection: 'channel:connection',
  pairing: 'channel:pairing',
  sessionsRead: 'channel:sessions:read',
  sessionsWrite: 'channel:sessions:write',
  messages: 'channel:messages',
  deliveries: 'channel:deliveries',
  notifications: 'channel:notifications',
  decisions: 'channel:decisions',
})

export const CHANNEL_HOST_METHOD_PERMISSIONS = Object.freeze({
  'connection.update': CHANNEL_PERMISSIONS.connection,
  'pairing.attempt': CHANNEL_PERMISSIONS.pairing,
  'conversation.list': CHANNEL_PERMISSIONS.sessionsRead,
  'conversation.current': CHANNEL_PERMISSIONS.sessionsRead,
  'conversation.create': CHANNEL_PERMISSIONS.sessionsWrite,
  'conversation.select': CHANNEL_PERMISSIONS.sessionsWrite,
  'session.abort': CHANNEL_PERMISSIONS.sessionsWrite,
  'message.receive': CHANNEL_PERMISSIONS.messages,
  'delivery.ack': CHANNEL_PERMISSIONS.deliveries,
  'decision.respond': CHANNEL_PERMISSIONS.decisions,
})

export const CHANNEL_BACKEND_EVENT_PERMISSIONS = Object.freeze({
  'turn.accepted': CHANNEL_PERMISSIONS.messages,
  'turn.output': CHANNEL_PERMISSIONS.messages,
  'turn.review_requested': CHANNEL_PERMISSIONS.messages,
  'turn.completed': CHANNEL_PERMISSIONS.messages,
  'turn.failed': CHANNEL_PERMISSIONS.messages,
  'notification.deliver': CHANNEL_PERMISSIONS.notifications,
  'decision.resolved': CHANNEL_PERMISSIONS.decisions,
})

export const CHANNEL_HOST_METHODS = Object.freeze(Object.keys(CHANNEL_HOST_METHOD_PERMISSIONS))
export const CHANNEL_BACKEND_EVENTS = Object.freeze(Object.keys(CHANNEL_BACKEND_EVENT_PERMISSIONS))

const MAX_MESSAGE_TEXT_LENGTH = 100_000
const MAX_ATTACHMENTS = 32
const MAX_ATTACHMENT_DATA_LENGTH = 512 * 1024

function requireKnownName(value, entries, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || !Object.hasOwn(entries, normalized)) {
    throw new AppServiceError(
      APP_ERROR_CODES.channelProtocol,
      `Unknown ${MOSS_CHANNEL_PROTOCOL} ${label}: ${normalized || '<empty>'}`,
    )
  }
  return normalized
}

export function validateChannelHostMethod(value) {
  return requireKnownName(value, CHANNEL_HOST_METHOD_PERMISSIONS, 'Host method')
}

export function validateChannelBackendEvent(value) {
  return requireKnownName(value, CHANNEL_BACKEND_EVENT_PERMISSIONS, 'Backend event')
}

export function getChannelHostMethodPermission(method) {
  return CHANNEL_HOST_METHOD_PERMISSIONS[validateChannelHostMethod(method)]
}

export function getChannelBackendEventPermission(name) {
  return CHANNEL_BACKEND_EVENT_PERMISSIONS[validateChannelBackendEvent(name)]
}

export function validateChannelProtocol(value) {
  if (value !== MOSS_CHANNEL_PROTOCOL) {
    throw new AppServiceError(
      APP_ERROR_CODES.channelProtocol,
      `Unsupported Channel protocol: ${String(value || '<empty>')}`,
    )
  }
  return value
}

export function validateChannelData(value, label = 'Channel payload') {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${label} must be an object`)
  }
  return value
}

function requireStringField(input, field, method, { optional = false, maxLength = 512 } = {}) {
  const value = input[field]
  if (optional && (value === undefined || value === null || value === '')) return
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidInput,
      `${method} requires a valid ${field}`,
    )
  }
}

function optionalStringField(input, field, method, { nullable = false, maxLength = 512 } = {}) {
  const value = input[field]
  if (value === undefined || (nullable && value === null)) return
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidInput,
      `${method} has an invalid ${field}`,
    )
  }
}

function rejectUnknownFields(input, fields, method) {
  const allowed = new Set(fields)
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) {
      throw new AppServiceError(
        APP_ERROR_CODES.invalidInput,
        `${method} contains an unknown field: ${field}`,
      )
    }
  }
}

function optionalInteger(input, field, method, minimum, maximum) {
  const value = input[field]
  if (value === undefined) return
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidInput,
      `${method} ${field} must be between ${minimum} and ${maximum}`,
    )
  }
}

function validateMetadata(value, method) {
  if (value === undefined) return
  const metadata = validateChannelData(value, `${method} metadata`)
  if (Object.keys(metadata).length > 64) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${method} metadata has too many fields`)
  }
  let serialized
  try {
    serialized = JSON.stringify(metadata)
  } catch {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${method} metadata must be JSON serializable`)
  }
  if (Buffer.byteLength(serialized || '', 'utf8') > 16 * 1024) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${method} metadata is too large`)
  }
}

export function validateChannelAttachments(value, method) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidInput,
      `${method} attachments must contain at most ${MAX_ATTACHMENTS} items`,
    )
  }
  for (const [index, attachmentValue] of value.entries()) {
    const label = `${method} attachments[${index}]`
    const attachment = validateChannelData(attachmentValue, label)
    rejectUnknownFields(attachment, ['type', 'name', 'mimeType', 'data', 'path'], label)
    if (!['file', 'image'].includes(attachment.type)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${label} has an invalid type`)
    }
    optionalStringField(attachment, 'name', label, { maxLength: 300 })
    optionalStringField(attachment, 'mimeType', label, { maxLength: 200 })
    optionalStringField(attachment, 'path', label, { maxLength: 4096 })
    optionalStringField(attachment, 'data', label, { maxLength: MAX_ATTACHMENT_DATA_LENGTH })
  }
}

export function validateChannelMessageContent(input, method) {
  if (input.text !== undefined
    && (typeof input.text !== 'string' || input.text.length > MAX_MESSAGE_TEXT_LENGTH)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${method} text is invalid`)
  }
  validateChannelAttachments(input.attachments, method)
  if ((!input.text || !input.text.trim()) && (!input.attachments || input.attachments.length === 0)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${method} requires text or attachments`)
  }
}

export function validateChannelHostInput(method, value) {
  const normalizedMethod = validateChannelHostMethod(method)
  const input = validateChannelData(value, `${normalizedMethod} input`)
  switch (normalizedMethod) {
    case 'connection.update':
      rejectUnknownFields(input, ['connected', 'error', 'metadata'], normalizedMethod)
      if (typeof input.connected !== 'boolean') {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'connection.update requires connected')
      }
      optionalStringField(input, 'error', normalizedMethod, { nullable: true, maxLength: 2_000 })
      validateMetadata(input.metadata, normalizedMethod)
      break
    case 'pairing.attempt':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId', 'code', 'displayName',
      ], normalizedMethod)
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod)
      requireStringField(input, 'externalEventId', normalizedMethod)
      requireStringField(input, 'code', normalizedMethod, { maxLength: 256 })
      optionalStringField(input, 'displayName', normalizedMethod, { maxLength: 300 })
      break
    case 'conversation.list':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId',
        'category', 'page', 'pageSize', 'query',
      ], normalizedMethod)
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireStringField(input, 'externalEventId', normalizedMethod, { optional: true })
      optionalStringField(input, 'category', normalizedMethod, { maxLength: 64 })
      optionalStringField(input, 'query', normalizedMethod, { maxLength: 500 })
      optionalInteger(input, 'page', normalizedMethod, 0, 1_000_000)
      optionalInteger(input, 'pageSize', normalizedMethod, 1, 100)
      break
    case 'conversation.current':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId',
      ], normalizedMethod)
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireStringField(input, 'externalEventId', normalizedMethod, { optional: true })
      break
    case 'session.abort':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId',
      ], normalizedMethod)
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireStringField(input, 'externalEventId', normalizedMethod)
      break
    case 'conversation.create':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId', 'title',
      ], normalizedMethod)
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireStringField(input, 'externalEventId', normalizedMethod)
      optionalStringField(input, 'title', normalizedMethod, { maxLength: 300 })
      break
    case 'conversation.select':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId', 'sessionId',
      ], normalizedMethod)
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireStringField(input, 'externalEventId', normalizedMethod)
      requireStringField(input, 'sessionId', normalizedMethod)
      break
    case 'message.receive':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId',
        'text', 'attachments', 'mentioned', 'source', 'hop',
      ], normalizedMethod)
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod)
      requireStringField(input, 'externalEventId', normalizedMethod)
      validateChannelMessageContent(input, normalizedMethod)
      if (input.mentioned !== undefined && typeof input.mentioned !== 'boolean') {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'message.receive mentioned must be a boolean')
      }
      if (input.source !== undefined && !['human', 'agent', 'system'].includes(input.source)) {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'message.receive source must be human, agent, or system')
      }
      if (input.hop !== undefined
        && (!Number.isInteger(input.hop) || input.hop < 0 || input.hop > 20)) {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'message.receive hop must be between 0 and 20')
      }
      break
    case 'delivery.ack':
      rejectUnknownFields(input, [
        'deliveryId', 'kind', 'ok', 'externalConversationId',
        'externalMessageId', 'externalCardId', 'error',
      ], normalizedMethod)
      requireStringField(input, 'deliveryId', normalizedMethod)
      if (typeof input.ok !== 'boolean') {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'delivery.ack requires ok')
      }
      if (input.kind !== undefined && !['turn', 'notification'].includes(input.kind)) {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'delivery.ack kind must be turn or notification')
      }
      if (input.kind === 'turn') {
        requireStringField(input, 'externalConversationId', normalizedMethod)
      }
      requireStringField(input, 'externalMessageId', normalizedMethod, { optional: true })
      requireStringField(input, 'externalCardId', normalizedMethod, { optional: true })
      optionalStringField(input, 'error', normalizedMethod, { maxLength: 2_000 })
      break
    case 'decision.respond':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId',
        'decisionId', 'actionToken', 'allowed',
      ], normalizedMethod)
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod)
      requireStringField(input, 'externalEventId', normalizedMethod)
      requireStringField(input, 'decisionId', normalizedMethod)
      requireStringField(input, 'actionToken', normalizedMethod, { maxLength: 4096 })
      if (typeof input.allowed !== 'boolean') {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'decision.respond requires allowed')
      }
      break
  }
  return input
}

export function validateChannelBackendEventData(name, value) {
  const normalizedName = validateChannelBackendEvent(name)
  const data = validateChannelData(value, `${normalizedName} data`)
  if (normalizedName.startsWith('turn.')) {
    requireStringField(data, 'turnId', normalizedName)
    requireStringField(data, 'externalConversationId', normalizedName)
  } else if (normalizedName === 'notification.deliver') {
    requireStringField(data, 'deliveryId', normalizedName)
    requireStringField(data, 'externalConversationId', normalizedName)
  } else if (normalizedName === 'decision.resolved') {
    requireStringField(data, 'decisionId', normalizedName)
  }
  return data
}

export function requireChannelPermission(permissions, requiredPermission) {
  if (!Array.isArray(permissions) || !permissions.includes(requiredPermission)) {
    throw new AppServiceError(
      APP_ERROR_CODES.permissionDenied,
      `App does not declare required permission: ${requiredPermission}`,
    )
  }
  return true
}
