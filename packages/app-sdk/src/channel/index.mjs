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

export function validateChannelHostInput(method, value) {
  const normalizedMethod = validateChannelHostMethod(method)
  const input = validateChannelData(value, `${normalizedMethod} input`)
  switch (normalizedMethod) {
    case 'connection.update':
      if (typeof input.connected !== 'boolean') {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'connection.update requires connected')
      }
      break
    case 'pairing.attempt':
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod)
      requireStringField(input, 'externalEventId', normalizedMethod)
      requireStringField(input, 'code', normalizedMethod, { maxLength: 256 })
      break
    case 'conversation.list':
    case 'conversation.current':
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod, { optional: true })
      break
    case 'conversation.create':
    case 'session.abort':
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireStringField(input, 'externalEventId', normalizedMethod)
      break
    case 'conversation.select':
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireStringField(input, 'externalEventId', normalizedMethod)
      requireStringField(input, 'sessionId', normalizedMethod)
      break
    case 'message.receive':
      requireStringField(input, 'externalUserId', normalizedMethod)
      requireStringField(input, 'externalConversationId', normalizedMethod)
      requireStringField(input, 'externalEventId', normalizedMethod)
      if (
        (typeof input.text !== 'string' || !input.text.trim())
        && (!Array.isArray(input.attachments) || input.attachments.length === 0)
      ) {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'message.receive requires text or attachments')
      }
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
      break
    case 'decision.respond':
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
