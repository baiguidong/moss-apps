const OPENIM_CONVERSATION_PREFIX = 'openim-user:'

function requiredIdentifier(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > 256 || encodeURIComponent(normalized).length > 220) {
    throw new TypeError(`${label} is invalid`)
  }
  return normalized
}

export function openIMConversationScope(userId) {
  return `${OPENIM_CONVERSATION_PREFIX}${encodeURIComponent(requiredIdentifier(userId, 'OpenIM user id'))}`
}

export function openIMDefaultConversationId(userId) {
  return `${openIMConversationScope(userId)}/*`
}

export function openIMDirectConversationId(userId, peerUserId) {
  return `${openIMConversationScope(userId)}/direct:${encodeURIComponent(requiredIdentifier(peerUserId, 'OpenIM peer user id'))}`
}

export function parseOpenIMDirectConversationId(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  const match = /^openim-user:([^/]+)\/direct:([^/]+)$/.exec(normalized)
  if (!match) return null
  try {
    const userId = decodeURIComponent(match[1]).trim()
    const peerUserId = decodeURIComponent(match[2]).trim()
    return userId && peerUserId ? { userId, peerUserId } : null
  } catch {
    return null
  }
}

export function openIMDefaultConversationIdFor(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  const direct = parseOpenIMDirectConversationId(normalized)
  if (direct) return openIMDefaultConversationId(direct.userId)
  const match = /^openim-user:([^/]+)\/\*$/.exec(normalized)
  if (!match) return null
  try {
    const userId = decodeURIComponent(match[1]).trim()
    return userId ? openIMDefaultConversationId(userId) : null
  } catch {
    return null
  }
}
