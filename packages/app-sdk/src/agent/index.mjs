import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'

export const MOSS_AGENT_PROTOCOL = 'moss.agent/v1'

export const AGENT_PERMISSIONS = Object.freeze({
  catalogRead: 'agent:catalog:read',
  bindingsRead: 'agent:bindings:read',
  bindingsWrite: 'agent:bindings:write',
  sessionsRead: 'agent:sessions:read',
  sessionsWrite: 'agent:sessions:write',
  turnsRead: 'agent:turns:read',
  turnsWrite: 'agent:turns:write',
})

export const AGENT_REPLY_MODES = Object.freeze([
  'human_only',
  'ai_auto',
  'ai_draft_review',
  'mention_only',
  'inherit',
])

export const AGENT_SESSION_MODES = Object.freeze([
  'fixed',
  'rotating',
  'new_each_turn',
])

// Channel Apps may narrow permissions, but may never request the unsafe
// bypassPermissions mode used by an explicitly controlled local session.
export const AGENT_PERMISSION_MODES = Object.freeze([
  'default',
  'acceptEdits',
  'dontAsk',
])

export const AGENT_CATALOG_KINDS = Object.freeze([
  'agents',
  'tools',
  'skills',
  'connectors',
])

export const AGENT_HOST_METHOD_PERMISSIONS = Object.freeze({
  'catalog.list': AGENT_PERMISSIONS.catalogRead,
  'binding.get': AGENT_PERMISSIONS.bindingsRead,
  'binding.update': AGENT_PERMISSIONS.bindingsWrite,
  'binding.reset': AGENT_PERMISSIONS.bindingsWrite,
  'session.list': AGENT_PERMISSIONS.sessionsRead,
  'session.current': AGENT_PERMISSIONS.sessionsRead,
  'session.create': AGENT_PERMISSIONS.sessionsWrite,
  'session.select': AGENT_PERMISSIONS.sessionsWrite,
  'session.abort': AGENT_PERMISSIONS.sessionsWrite,
  'context.observe': AGENT_PERMISSIONS.turnsWrite,
  'turn.start': AGENT_PERMISSIONS.turnsWrite,
  'turn.list': AGENT_PERMISSIONS.turnsRead,
  'turn.get': AGENT_PERMISSIONS.turnsRead,
  'turn.abort': AGENT_PERMISSIONS.turnsWrite,
  'turn.reply': AGENT_PERMISSIONS.turnsWrite,
  'turn.review': AGENT_PERMISSIONS.turnsWrite,
  'turn.delivery.ack': AGENT_PERMISSIONS.turnsWrite,
})

export const AGENT_BACKEND_EVENT_PERMISSIONS = Object.freeze({
  'binding.changed': AGENT_PERMISSIONS.bindingsRead,
  'turn.accepted': AGENT_PERMISSIONS.turnsRead,
  'turn.review_requested': AGENT_PERMISSIONS.turnsRead,
  'turn.completed': AGENT_PERMISSIONS.turnsRead,
  'turn.failed': AGENT_PERMISSIONS.turnsRead,
})

export const AGENT_HOST_METHODS = Object.freeze(Object.keys(AGENT_HOST_METHOD_PERMISSIONS))
export const AGENT_BACKEND_EVENTS = Object.freeze(Object.keys(AGENT_BACKEND_EVENT_PERMISSIONS))

function fail(message) {
  throw new AppServiceError(APP_ERROR_CODES.invalidInput, message)
}

function requireKnownName(value, entries, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || !Object.hasOwn(entries, normalized)) {
    throw new AppServiceError(
      APP_ERROR_CODES.hostProtocol,
      `Unknown ${MOSS_AGENT_PROTOCOL} ${label}: ${normalized || '<empty>'}`,
    )
  }
  return normalized
}

function record(value, label) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function requireText(input, field, method, { optional = false, maxLength = 512 } = {}) {
  const value = input[field]
  if (optional && (value === undefined || value === null || value === '')) return
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    fail(`${method} requires a valid ${field}`)
  }
}

function validateStringList(value, label, { nullable = true, maxItems = 256 } = {}) {
  if (value === undefined) return
  if (nullable && value === null) return
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} must be an array with at most ${maxItems} items`)
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.length > 256) fail(`${label} contains an invalid value`)
  }
}

const MAX_MESSAGE_TEXT_LENGTH = 100_000
const MAX_ATTACHMENTS = 32
const MAX_ATTACHMENT_DATA_LENGTH = 512 * 1024

function optionalText(input, field, method, { nullable = false, maxLength = 512 } = {}) {
  const value = input[field]
  if (value === undefined || (nullable && value === null)) return
  if (typeof value !== 'string' || value.length > maxLength) fail(`${method} has an invalid ${field}`)
}

function optionalInteger(input, field, method, minimum, maximum) {
  const value = input[field]
  if (value === undefined) return
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${method} ${field} must be between ${minimum} and ${maximum}`)
  }
}

export function validateAgentAttachments(value, method) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    fail(`${method} attachments must contain at most ${MAX_ATTACHMENTS} items`)
  }
  for (const [index, attachmentValue] of value.entries()) {
    const label = `${method} attachments[${index}]`
    const attachment = record(attachmentValue, label)
    rejectUnknownFields(attachment, ['type', 'name', 'mimeType', 'data', 'path'], label)
    if (!['file', 'image'].includes(attachment.type)) fail(`${label} has an invalid type`)
    optionalText(attachment, 'name', label, { maxLength: 300 })
    optionalText(attachment, 'mimeType', label, { maxLength: 200 })
    optionalText(attachment, 'path', label, { maxLength: 4096 })
    optionalText(attachment, 'data', label, { maxLength: MAX_ATTACHMENT_DATA_LENGTH })
  }
}

export function validateAgentMessageContent(input, method) {
  if (input.text !== undefined
    && (typeof input.text !== 'string' || input.text.length > MAX_MESSAGE_TEXT_LENGTH)) {
    fail(`${method} text is invalid`)
  }
  validateAgentAttachments(input.attachments, method)
  if ((!input.text || !input.text.trim()) && (!input.attachments || input.attachments.length === 0)) {
    fail(`${method} requires text or attachments`)
  }
}

function validateBindingTarget(input, method) {
  requireText(input, 'externalConversationId', method)
  requireText(input, 'externalMemberId', method, { optional: true })
}

function rejectUnknownFields(input, fields, method) {
  const allowed = new Set(fields)
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) fail(`${method} contains an unknown field: ${field}`)
  }
}

function validateBindingPatch(value) {
  const patch = record(value, 'binding.update patch')
  const allowed = new Set(['inheritDefault', 'replyMode', 'agentId', 'permissionMode', 'resources', 'session', 'proactive'])
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) fail(`binding.update patch contains an unknown field: ${key}`)
  }
  if (patch.inheritDefault !== undefined && typeof patch.inheritDefault !== 'boolean') {
    fail('binding.update patch.inheritDefault must be a boolean')
  }
  if (patch.replyMode !== undefined && !AGENT_REPLY_MODES.includes(patch.replyMode)) {
    fail('binding.update patch has an invalid replyMode')
  }
  if (patch.agentId !== undefined && patch.agentId !== null) {
    if (typeof patch.agentId !== 'string' || !patch.agentId.trim() || patch.agentId.length > 128) {
      fail('binding.update patch has an invalid agentId')
    }
  }
  if (patch.permissionMode !== undefined && patch.permissionMode !== null
    && !AGENT_PERMISSION_MODES.includes(patch.permissionMode)) {
    fail('binding.update patch has an invalid permissionMode')
  }
  if (patch.resources !== undefined && patch.resources !== null) {
    const resources = record(patch.resources, 'binding.update resources')
    for (const key of Object.keys(resources)) {
      if (!['tools', 'skills', 'connectors'].includes(key)) {
        fail(`binding.update resources contains an unknown field: ${key}`)
      }
    }
    validateStringList(resources.tools, 'binding.update resources.tools')
    validateStringList(resources.skills, 'binding.update resources.skills')
    validateStringList(resources.connectors, 'binding.update resources.connectors')
  }
  if (patch.session !== undefined && patch.session !== null) {
    const session = record(patch.session, 'binding.update session')
    for (const key of Object.keys(session)) {
      if (!['mode', 'rotateAfterTurns'].includes(key)) {
        fail(`binding.update session contains an unknown field: ${key}`)
      }
    }
    if (session.mode !== undefined && !AGENT_SESSION_MODES.includes(session.mode)) {
      fail('binding.update session has an invalid mode')
    }
    if (session.rotateAfterTurns !== undefined
      && (!Number.isInteger(session.rotateAfterTurns)
        || session.rotateAfterTurns < 1
        || session.rotateAfterTurns > 1000)) {
      fail('binding.update session.rotateAfterTurns must be between 1 and 1000')
    }
  }
  if (patch.proactive !== undefined && patch.proactive !== null) {
    const proactive = record(patch.proactive, 'binding.update proactive')
    for (const key of Object.keys(proactive)) {
      if (!['enabled', 'maxConsecutiveReplies', 'cooldownMs'].includes(key)) {
        fail(`binding.update proactive contains an unknown field: ${key}`)
      }
    }
    if (proactive.enabled !== undefined && typeof proactive.enabled !== 'boolean') {
      fail('binding.update proactive.enabled must be a boolean')
    }
    if (proactive.maxConsecutiveReplies !== undefined
      && (!Number.isInteger(proactive.maxConsecutiveReplies)
        || proactive.maxConsecutiveReplies < 1
        || proactive.maxConsecutiveReplies > 20)) {
      fail('binding.update proactive.maxConsecutiveReplies must be between 1 and 20')
    }
    if (proactive.cooldownMs !== undefined
      && (!Number.isInteger(proactive.cooldownMs)
        || proactive.cooldownMs < 0
        || proactive.cooldownMs > 86_400_000)) {
      fail('binding.update proactive.cooldownMs must be between 0 and 86400000')
    }
  }
  return patch
}

export function validateAgentHostMethod(value) {
  return requireKnownName(value, AGENT_HOST_METHOD_PERMISSIONS, 'Host method')
}

export function validateAgentBackendEvent(value) {
  return requireKnownName(value, AGENT_BACKEND_EVENT_PERMISSIONS, 'Backend event')
}

export function validateAgentHostInput(method, value) {
  const normalizedMethod = validateAgentHostMethod(method)
  const input = record(value, `${normalizedMethod} input`)
  for (const field of ['appId', 'instanceId', 'owner', 'principal']) {
    if (Object.hasOwn(input, field)) fail(`${normalizedMethod} cannot override Runtime identity: ${field}`)
  }
  switch (normalizedMethod) {
    case 'catalog.list':
      rejectUnknownFields(input, ['kinds'], normalizedMethod)
      if (input.kinds !== undefined) {
        validateStringList(input.kinds, 'catalog.list kinds', { nullable: false, maxItems: AGENT_CATALOG_KINDS.length })
        if (input.kinds.some((kind) => !AGENT_CATALOG_KINDS.includes(kind))) fail('catalog.list contains an unknown kind')
      }
      break
    case 'binding.get':
      rejectUnknownFields(input, ['externalConversationId', 'externalMemberId', 'defaultConversationId'], normalizedMethod)
      validateBindingTarget(input, normalizedMethod)
      requireText(input, 'defaultConversationId', normalizedMethod, { optional: true })
      break
    case 'binding.update':
      rejectUnknownFields(input, [
        'externalConversationId', 'externalMemberId', 'defaultConversationId', 'expectedRevision', 'patch',
      ], normalizedMethod)
      validateBindingTarget(input, normalizedMethod)
      requireText(input, 'defaultConversationId', normalizedMethod, { optional: true })
      if (!Object.hasOwn(input, 'patch')) fail('binding.update requires a patch')
      validateBindingPatch(input.patch)
      if (input.expectedRevision !== undefined
        && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0)) {
        fail('binding.update expectedRevision must be a non-negative integer')
      }
      break
    case 'binding.reset':
      rejectUnknownFields(input, [
        'externalConversationId', 'externalMemberId', 'defaultConversationId', 'expectedRevision',
      ], normalizedMethod)
      validateBindingTarget(input, normalizedMethod)
      requireText(input, 'defaultConversationId', normalizedMethod, { optional: true })
      if (input.expectedRevision !== undefined
        && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0)) {
        fail('binding.reset expectedRevision must be a non-negative integer')
      }
      break
    case 'session.list':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId',
        'category', 'page', 'pageSize', 'query',
      ], normalizedMethod)
      requireText(input, 'externalUserId', normalizedMethod)
      requireText(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireText(input, 'externalEventId', normalizedMethod, { optional: true })
      optionalText(input, 'category', normalizedMethod, { maxLength: 64 })
      optionalText(input, 'query', normalizedMethod, { maxLength: 500 })
      optionalInteger(input, 'page', normalizedMethod, 0, 1_000_000)
      optionalInteger(input, 'pageSize', normalizedMethod, 1, 100)
      break
    case 'session.current':
      rejectUnknownFields(input, ['externalUserId', 'externalConversationId', 'externalEventId'], normalizedMethod)
      requireText(input, 'externalUserId', normalizedMethod)
      requireText(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireText(input, 'externalEventId', normalizedMethod, { optional: true })
      break
    case 'session.abort':
      rejectUnknownFields(input, ['externalUserId', 'externalConversationId', 'externalEventId'], normalizedMethod)
      requireText(input, 'externalUserId', normalizedMethod)
      requireText(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireText(input, 'externalEventId', normalizedMethod)
      break
    case 'session.create':
      rejectUnknownFields(input, ['externalUserId', 'externalConversationId', 'externalEventId', 'title'], normalizedMethod)
      requireText(input, 'externalUserId', normalizedMethod)
      requireText(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireText(input, 'externalEventId', normalizedMethod)
      optionalText(input, 'title', normalizedMethod, { maxLength: 300 })
      break
    case 'session.select':
      rejectUnknownFields(input, ['externalUserId', 'externalConversationId', 'externalEventId', 'sessionId'], normalizedMethod)
      requireText(input, 'externalUserId', normalizedMethod)
      requireText(input, 'externalConversationId', normalizedMethod, { optional: true })
      requireText(input, 'externalEventId', normalizedMethod)
      requireText(input, 'sessionId', normalizedMethod)
      break
    case 'context.observe':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId', 'text',
      ], normalizedMethod)
      requireText(input, 'externalUserId', normalizedMethod)
      requireText(input, 'externalConversationId', normalizedMethod)
      requireText(input, 'externalEventId', normalizedMethod)
      requireText(input, 'text', normalizedMethod, { maxLength: 100_000 })
      break
    case 'turn.start':
      rejectUnknownFields(input, [
        'externalUserId', 'externalConversationId', 'externalEventId', 'defaultConversationId',
        'text', 'attachments', 'mentioned', 'source', 'hop',
      ], normalizedMethod)
      requireText(input, 'externalUserId', normalizedMethod)
      requireText(input, 'externalConversationId', normalizedMethod)
      requireText(input, 'externalEventId', normalizedMethod)
      requireText(input, 'defaultConversationId', normalizedMethod, { optional: true })
      validateAgentMessageContent(input, normalizedMethod)
      if (input.mentioned !== undefined && typeof input.mentioned !== 'boolean') {
        fail('turn.start mentioned must be a boolean')
      }
      if (input.source !== undefined && !['human', 'agent', 'system'].includes(input.source)) {
        fail('turn.start source must be human, agent, or system')
      }
      if (input.hop !== undefined
        && (!Number.isInteger(input.hop) || input.hop < 0 || input.hop > 20)) {
        fail('turn.start hop must be between 0 and 20')
      }
      break
    case 'turn.get':
    case 'turn.abort':
      rejectUnknownFields(input, ['turnId'], normalizedMethod)
      requireText(input, 'turnId', normalizedMethod)
      break
    case 'turn.delivery.ack':
      rejectUnknownFields(input, [
        'turnId', 'externalConversationId', 'ok', 'externalMessageId', 'error',
      ], normalizedMethod)
      requireText(input, 'turnId', normalizedMethod)
      requireText(input, 'externalConversationId', normalizedMethod)
      if (typeof input.ok !== 'boolean') fail('turn.delivery.ack requires ok')
      requireText(input, 'externalMessageId', normalizedMethod, { optional: true, maxLength: 512 })
      requireText(input, 'error', normalizedMethod, { optional: true, maxLength: 2_000 })
      break
    case 'turn.list':
      rejectUnknownFields(input, ['externalConversationId', 'statuses', 'limit'], normalizedMethod)
      requireText(input, 'externalConversationId', normalizedMethod, { optional: true })
      if (input.statuses !== undefined) {
        validateStringList(input.statuses, 'turn.list statuses', { nullable: false, maxItems: 9 })
        const statuses = new Set([
          'received', 'human', 'queued', 'running', 'awaiting_review',
          'completed', 'rejected', 'failed', 'cancelled',
        ])
        if (input.statuses.some((status) => !statuses.has(status))) fail('turn.list contains an invalid status')
      }
      if (input.limit !== undefined
        && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200)) {
        fail('turn.list limit must be between 1 and 200')
      }
      break
    case 'turn.review':
      rejectUnknownFields(input, ['turnId', 'action', 'text'], normalizedMethod)
      requireText(input, 'turnId', normalizedMethod)
      if (!['approve', 'reject'].includes(input.action)) {
        fail('turn.review action must be approve or reject')
      }
      if (input.text !== undefined && (typeof input.text !== 'string' || input.text.length > 100_000)) {
        fail('turn.review text is invalid')
      }
      break
    case 'turn.reply':
      rejectUnknownFields(input, ['turnId', 'action', 'text'], normalizedMethod)
      requireText(input, 'turnId', normalizedMethod)
      if (!['send', 'dismiss'].includes(input.action)) {
        fail('turn.reply action must be send or dismiss')
      }
      if (input.action === 'send') requireText(input, 'text', normalizedMethod, { maxLength: 100_000 })
      if (input.text !== undefined && (typeof input.text !== 'string' || input.text.length > 100_000)) {
        fail('turn.reply text is invalid')
      }
      break
  }
  return input
}

function outputRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} must be an object`)
  }
  return value
}

function outputText(value, label, { nullable = false, maxLength = 100_000 } = {}) {
  if (nullable && value === null) return
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} is invalid`)
  }
}

function outputInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} is invalid`)
  }
}

function rejectUnknownOutputFields(output, fields, label) {
  const allowed = new Set(fields)
  for (const field of Object.keys(output)) {
    if (!allowed.has(field)) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} contains an unknown field: ${field}`)
    }
  }
}

function validateSessionSummary(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return
  const session = outputRecord(value, label)
  rejectUnknownOutputFields(session, [
    'id', 'title', 'preview', 'updatedAt', 'busy', 'projectName', 'originChannel', 'messageCount',
  ], label)
  outputText(session.id, `${label}.id`)
  outputText(session.title, `${label}.title`)
  outputInteger(session.updatedAt, `${label}.updatedAt`)
  if (typeof session.busy !== 'boolean') {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label}.busy is invalid`)
  }
}

function validateBindingShape(value, label) {
  const binding = outputRecord(value, label)
  rejectUnknownOutputFields(binding, [
    'id', 'appId', 'instanceId', 'externalConversationId', 'externalMemberId',
    'policy', 'revision', 'createdAt', 'updatedAt',
  ], label)
}

function validateEffectiveBindingShape(value, label) {
  const effective = outputRecord(value, label)
  rejectUnknownOutputFields(effective, [
    'appId', 'instanceId', 'externalConversationId', 'externalMemberId', 'replyMode',
    'agentId', 'permissionMode', 'resources', 'session', 'proactive', 'inheritDefault',
    'revision', 'sourceRevisions', 'inherited', 'agentAvailable', 'unavailableResources',
  ], label)
}

const AGENT_TURN_STATUSES = new Set([
  'received', 'human', 'queued', 'running', 'awaiting_review',
  'completed', 'rejected', 'failed', 'cancelled',
])

function validatePublicTurn(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return
  const turn = outputRecord(value, label)
  rejectUnknownOutputFields(turn, [
    'id', 'externalConversationId', 'externalUserId', 'externalEventId', 'source', 'hop',
    'sessionId', 'status', 'replyMode', 'input', 'resultText', 'reviewedText', 'error',
    'deliveredAt', 'createdAt', 'updatedAt',
  ], label)
  for (const field of ['id', 'externalConversationId', 'externalUserId', 'externalEventId']) {
    outputText(turn[field], `${label}.${field}`)
  }
  if (!AGENT_TURN_STATUSES.has(turn.status)) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label}.status is invalid`)
  }
  if (!AGENT_REPLY_MODES.includes(turn.replyMode)) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label}.replyMode is invalid`)
  }
  outputInteger(turn.hop, `${label}.hop`)
  if (turn.sessionId !== null) outputText(turn.sessionId, `${label}.sessionId`)
  outputRecord(turn.input, `${label}.input`)
  if (turn.resultText !== undefined && typeof turn.resultText !== 'string') {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label}.resultText is invalid`)
  }
  if (turn.reviewedText !== undefined && typeof turn.reviewedText !== 'string') {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label}.reviewedText is invalid`)
  }
}

function validateBindingResult(output, method, { reset = false } = {}) {
  if (reset) {
    if (typeof output.reset !== 'boolean' || output.binding !== null) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${method} output reset state is invalid`)
    }
  } else if (output.binding !== null) {
    validateBindingShape(output.binding, `${method} output binding`)
  }
  validateEffectiveBindingShape(output.effective, `${method} output effective`)
}

export function validateAgentHostOutput(method, value) {
  const normalizedMethod = validateAgentHostMethod(method)
  const output = outputRecord(value, `${normalizedMethod} output`)
  if (normalizedMethod === 'catalog.list') {
    rejectUnknownOutputFields(output, AGENT_CATALOG_KINDS, 'catalog.list output')
    for (const kind of AGENT_CATALOG_KINDS) {
      if (output[kind] !== undefined && (!Array.isArray(output[kind]) || output[kind].length > 10_000)) {
        throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `catalog.list output ${kind} is invalid`)
      }
    }
  } else if (normalizedMethod === 'binding.get' || normalizedMethod === 'binding.update') {
    rejectUnknownOutputFields(output, ['binding', 'effective'], `${normalizedMethod} output`)
    validateBindingResult(output, normalizedMethod)
  } else if (normalizedMethod === 'binding.reset') {
    rejectUnknownOutputFields(output, ['reset', 'binding', 'effective'], 'binding.reset output')
    validateBindingResult(output, normalizedMethod, { reset: true })
  } else if (normalizedMethod === 'session.list') {
    rejectUnknownOutputFields(output, [
      'sessions', 'currentSession', 'page', 'pageSize', 'total', 'hasPrevious', 'hasNext',
    ], 'session.list output')
    if (!Array.isArray(output.sessions) || output.sessions.length > 100) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'session.list output sessions is invalid')
    }
    output.sessions.forEach((session, index) => validateSessionSummary(session, `session.list output sessions[${index}]`))
    validateSessionSummary(output.currentSession, 'session.list output currentSession', { nullable: true })
    for (const field of ['page', 'pageSize', 'total']) outputInteger(output[field], `session.list output ${field}`)
    if (typeof output.hasPrevious !== 'boolean' || typeof output.hasNext !== 'boolean') {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'session.list output pagination is invalid')
    }
  } else if (normalizedMethod === 'session.current') {
    rejectUnknownOutputFields(output, ['session'], 'session.current output')
    validateSessionSummary(output.session, 'session.current output session', { nullable: true })
  } else if (normalizedMethod === 'session.create' || normalizedMethod === 'session.select') {
    rejectUnknownOutputFields(output, ['session'], `${normalizedMethod} output`)
    validateSessionSummary(output.session, `${normalizedMethod} output session`)
  } else if (normalizedMethod === 'session.abort') {
    rejectUnknownOutputFields(output, ['cancelled', 'session'], 'session.abort output')
    outputInteger(output.cancelled, 'session.abort output cancelled')
    validateSessionSummary(output.session, 'session.abort output session')
  } else if (normalizedMethod === 'context.observe') {
    rejectUnknownOutputFields(output, ['observed', 'duplicate'], 'context.observe output')
    if (typeof output.observed !== 'boolean' || typeof output.duplicate !== 'boolean') {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'context.observe output is invalid')
    }
  } else if (normalizedMethod === 'turn.start') {
    rejectUnknownOutputFields(output, [
      'accepted', 'routing', 'duplicate', 'turnId', 'status', 'sessionId',
      'queued', 'session', 'reason',
    ], 'turn.start output')
    if (typeof output.accepted !== 'boolean' || typeof output.duplicate !== 'boolean') {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'turn.start output flags are invalid')
    }
    outputText(output.turnId, 'turn.start output turnId')
    if (!AGENT_TURN_STATUSES.has(output.status)) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'turn.start output status is invalid')
    }
    if (!['human', ...AGENT_REPLY_MODES].includes(output.routing)) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'turn.start output routing is invalid')
    }
    if (output.sessionId !== null) outputText(output.sessionId, 'turn.start output sessionId')
    if (output.queued !== undefined && typeof output.queued !== 'boolean') {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'turn.start output queued is invalid')
    }
    if (output.reason !== undefined) outputText(output.reason, 'turn.start output reason')
    if (output.session !== undefined) validateSessionSummary(output.session, 'turn.start output session')
  } else if (normalizedMethod === 'turn.list') {
    rejectUnknownOutputFields(output, ['turns'], 'turn.list output')
    if (!Array.isArray(output.turns) || output.turns.length > 200) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'turn.list output turns is invalid')
    }
    output.turns.forEach((turn, index) => validatePublicTurn(turn, `turn.list output turns[${index}]`))
  } else if (normalizedMethod === 'turn.get') {
    rejectUnknownOutputFields(output, ['turn'], 'turn.get output')
    validatePublicTurn(output.turn, 'turn.get output turn', { nullable: true })
  } else if (['turn.abort', 'turn.reply', 'turn.review'].includes(normalizedMethod)) {
    rejectUnknownOutputFields(
      output,
      normalizedMethod === 'turn.abort' ? ['turn', 'aborted'] : ['turn'],
      `${normalizedMethod} output`,
    )
    validatePublicTurn(output.turn, `${normalizedMethod} output turn`)
    if (normalizedMethod === 'turn.abort' && typeof output.aborted !== 'boolean') {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'turn.abort output aborted is invalid')
    }
  } else if (normalizedMethod === 'turn.delivery.ack') {
    rejectUnknownOutputFields(output, ['acknowledged', 'turnId', 'status'], 'turn.delivery.ack output')
    if (typeof output.acknowledged !== 'boolean') {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'turn.delivery.ack output acknowledged is invalid')
    }
    outputText(output.turnId, 'turn.delivery.ack output turnId')
    if (!AGENT_TURN_STATUSES.has(output.status)) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'turn.delivery.ack output status is invalid')
    }
  }
  return output
}

export function validateAgentBackendEventData(name, value) {
  const normalizedName = validateAgentBackendEvent(name)
  const data = record(value, `${normalizedName} data`)
  if (normalizedName === 'binding.changed') {
    requireText(data, 'externalConversationId', normalizedName)
    if (!Number.isInteger(data.revision) || data.revision < 0) {
      fail('binding.changed requires a non-negative revision')
    }
  } else {
    requireText(data, 'turnId', normalizedName)
    requireText(data, 'externalConversationId', normalizedName)
  }
  return data
}
