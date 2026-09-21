import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'

export const MOSS_AGENT_PROTOCOL = 'moss.agent/v1'

export const AGENT_PERMISSIONS = Object.freeze({
  catalogRead: 'agent:catalog:read',
  bindingsRead: 'agent:bindings:read',
  bindingsWrite: 'agent:bindings:write',
  turnsRead: 'agent:turns:read',
  turnsWrite: 'agent:turns:write',
})

export const AGENT_REPLY_MODES = Object.freeze([
  'human_only', 'ai_auto', 'ai_draft_review', 'mention_only', 'inherit',
])
export const AGENT_SESSION_MODES = Object.freeze(['fixed', 'rotating', 'new_each_turn'])
export const AGENT_CHANNEL_PERMISSION_MODES = Object.freeze(['default', 'acceptEdits', 'dontAsk'])
export const AGENT_CATALOG_KINDS = Object.freeze(['agents', 'tools', 'skills', 'connectors'])

export const AGENT_HOST_METHOD_PERMISSIONS = Object.freeze({
  'catalog.list': AGENT_PERMISSIONS.catalogRead,
  'binding.get': AGENT_PERMISSIONS.bindingsRead,
  'binding.update': AGENT_PERMISSIONS.bindingsWrite,
  'turn.start': AGENT_PERMISSIONS.turnsWrite,
  'turn.list': AGENT_PERMISSIONS.turnsRead,
  'turn.get': AGENT_PERMISSIONS.turnsRead,
  'turn.abort': AGENT_PERMISSIONS.turnsWrite,
  'turn.reply': AGENT_PERMISSIONS.turnsWrite,
  'turn.review': AGENT_PERMISSIONS.turnsWrite,
})

export const AGENT_BACKEND_EVENT_PERMISSIONS = Object.freeze({
  'binding.changed': AGENT_PERMISSIONS.bindingsRead,
  'turn.accepted': AGENT_PERMISSIONS.turnsRead,
  'turn.output': AGENT_PERMISSIONS.turnsRead,
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
  if (value === undefined || (nullable && value === null)) return
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} must be an array with at most ${maxItems} items`)
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.length > 256) fail(`${label} contains an invalid value`)
  }
}

function validateBindingTarget(input, method) {
  requireText(input, 'externalConversationId', method)
  requireText(input, 'externalMemberId', method, { optional: true })
}

function validateBindingPatch(value) {
  const patch = record(value, 'binding.update patch')
  const allowed = new Set(['replyMode', 'agentId', 'permissionMode', 'resources', 'session', 'proactive'])
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) fail(`binding.update patch contains an unknown field: ${key}`)
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
    && !AGENT_CHANNEL_PERMISSION_MODES.includes(patch.permissionMode)) {
    fail('binding.update patch has an invalid permissionMode')
  }
  if (patch.resources !== undefined && patch.resources !== null) {
    const resources = record(patch.resources, 'binding.update resources')
    for (const key of Object.keys(resources)) {
      if (!['tools', 'skills', 'connectors'].includes(key)) fail(`binding.update resources contains an unknown field: ${key}`)
    }
    validateStringList(resources.tools, 'binding.update resources.tools')
    validateStringList(resources.skills, 'binding.update resources.skills')
    validateStringList(resources.connectors, 'binding.update resources.connectors')
  }
  if (patch.session !== undefined && patch.session !== null) {
    const session = record(patch.session, 'binding.update session')
    for (const key of Object.keys(session)) {
      if (!['mode', 'rotateAfterTurns'].includes(key)) fail(`binding.update session contains an unknown field: ${key}`)
    }
    if (session.mode !== undefined && !AGENT_SESSION_MODES.includes(session.mode)) {
      fail('binding.update session has an invalid mode')
    }
    if (session.rotateAfterTurns !== undefined
      && (!Number.isInteger(session.rotateAfterTurns) || session.rotateAfterTurns < 1 || session.rotateAfterTurns > 1000)) {
      fail('binding.update session.rotateAfterTurns must be between 1 and 1000')
    }
  }
  if (patch.proactive !== undefined && patch.proactive !== null) {
    const proactive = record(patch.proactive, 'binding.update proactive')
    for (const key of Object.keys(proactive)) {
      if (!['enabled', 'maxConsecutiveReplies', 'cooldownMs'].includes(key)) fail(`binding.update proactive contains an unknown field: ${key}`)
    }
    if (proactive.enabled !== undefined && typeof proactive.enabled !== 'boolean') fail('binding.update proactive.enabled must be a boolean')
    if (proactive.maxConsecutiveReplies !== undefined
      && (!Number.isInteger(proactive.maxConsecutiveReplies) || proactive.maxConsecutiveReplies < 1 || proactive.maxConsecutiveReplies > 20)) {
      fail('binding.update proactive.maxConsecutiveReplies must be between 1 and 20')
    }
    if (proactive.cooldownMs !== undefined
      && (!Number.isInteger(proactive.cooldownMs) || proactive.cooldownMs < 0 || proactive.cooldownMs > 86_400_000)) {
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
      if (input.kinds !== undefined) {
        validateStringList(input.kinds, 'catalog.list kinds', { nullable: false, maxItems: AGENT_CATALOG_KINDS.length })
        if (input.kinds.some((kind) => !AGENT_CATALOG_KINDS.includes(kind))) fail('catalog.list contains an unknown kind')
      }
      break
    case 'binding.get':
      validateBindingTarget(input, normalizedMethod)
      break
    case 'binding.update':
      validateBindingTarget(input, normalizedMethod)
      validateBindingPatch(input.patch)
      if (input.expectedRevision !== undefined
        && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0)) {
        fail('binding.update expectedRevision must be a non-negative integer')
      }
      break
    case 'turn.start':
      requireText(input, 'externalUserId', normalizedMethod)
      requireText(input, 'externalConversationId', normalizedMethod)
      requireText(input, 'externalEventId', normalizedMethod)
      if ((typeof input.text !== 'string' || !input.text.trim())
        && (!Array.isArray(input.attachments) || input.attachments.length === 0)) {
        fail('turn.start requires text or attachments')
      }
      if (input.mentioned !== undefined && typeof input.mentioned !== 'boolean') fail('turn.start mentioned must be a boolean')
      if (input.source !== undefined && !['human', 'agent', 'system'].includes(input.source)) fail('turn.start source must be human, agent, or system')
      if (input.hop !== undefined && (!Number.isInteger(input.hop) || input.hop < 0 || input.hop > 20)) fail('turn.start hop must be between 0 and 20')
      break
    case 'turn.list':
      requireText(input, 'externalConversationId', normalizedMethod, { optional: true })
      if (input.statuses !== undefined) {
        validateStringList(input.statuses, 'turn.list statuses', { nullable: false, maxItems: 9 })
        const statuses = new Set(['received', 'human', 'queued', 'running', 'awaiting_review', 'completed', 'rejected', 'failed', 'cancelled'])
        if (input.statuses.some((status) => !statuses.has(status))) fail('turn.list contains an invalid status')
      }
      if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200)) fail('turn.list limit must be between 1 and 200')
      break
    case 'turn.get':
    case 'turn.abort':
      requireText(input, 'turnId', normalizedMethod)
      break
    case 'turn.reply':
      requireText(input, 'turnId', normalizedMethod)
      if (!['send', 'dismiss'].includes(input.action)) fail('turn.reply action must be send or dismiss')
      if (input.action === 'send') requireText(input, 'text', normalizedMethod, { maxLength: 100_000 })
      if (input.text !== undefined && (typeof input.text !== 'string' || input.text.length > 100_000)) fail('turn.reply text is invalid')
      break
    case 'turn.review':
      requireText(input, 'turnId', normalizedMethod)
      if (!['approve', 'reject'].includes(input.action)) fail('turn.review action must be approve or reject')
      if (input.text !== undefined && (typeof input.text !== 'string' || input.text.length > 100_000)) fail('turn.review text is invalid')
      break
  }
  return input
}

export function validateAgentBackendEventData(name, value) {
  const normalizedName = validateAgentBackendEvent(name)
  const data = record(value, `${normalizedName} data`)
  if (normalizedName === 'binding.changed') {
    requireText(data, 'externalConversationId', normalizedName)
    if (!Number.isInteger(data.revision) || data.revision < 1) fail('binding.changed requires a positive revision')
  } else {
    requireText(data, 'turnId', normalizedName)
    requireText(data, 'externalConversationId', normalizedName)
  }
  return data
}
