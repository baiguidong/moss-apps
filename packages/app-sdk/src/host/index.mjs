import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'

const HOST_PROTOCOL_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,94}[a-z0-9])?\/v[1-9][0-9]*$/
const HOST_MEMBER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

export function validateHostProtocol(value) {
  const protocol = typeof value === 'string' ? value.trim() : ''
  if (!HOST_PROTOCOL_PATTERN.test(protocol) || protocol.length > 100) {
    throw new AppServiceError(
      APP_ERROR_CODES.hostProtocol,
      `Invalid Host protocol: ${protocol || '<empty>'}`,
    )
  }
  return protocol
}
export function validateHostMember(value, label = 'Host protocol member') {
  const member = typeof value === 'string' ? value.trim() : ''
  if (!HOST_MEMBER_PATTERN.test(member) || member.length > 128) {
    throw new AppServiceError(
      APP_ERROR_CODES.hostProtocol,
      `Invalid ${label}: ${member || '<empty>'}`,
    )
  }
  return member
}

export function validateHostData(value, label = 'Host protocol payload') {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${label} must be an object`)
  }
  return value
}

export function requireHostProtocol(protocols, protocol) {
  const normalized = validateHostProtocol(protocol)
  if (!Array.isArray(protocols) || !protocols.includes(normalized)) {
    throw new AppServiceError(
      APP_ERROR_CODES.hostUnavailable,
      `App Backend does not declare protocol: ${normalized}`,
    )
  }
  return true
}

export function requireHostPermission(permissions, requiredPermission, options = {}) {
  if (!requiredPermission) return true
  if (!Array.isArray(permissions) || !permissions.includes(requiredPermission)) {
    const source = options.source === 'grant' ? 'grant' : 'declaration'
    throw new AppServiceError(
      APP_ERROR_CODES.permissionDenied,
      `App does not have required permission ${source}: ${requiredPermission}`,
    )
  }
  return true
}
