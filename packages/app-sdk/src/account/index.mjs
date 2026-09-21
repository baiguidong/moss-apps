import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'

export const MOSS_ACCOUNT_PROTOCOL = 'moss.account/v1'

export const ACCOUNT_PERMISSIONS = Object.freeze({
  identityRead: 'account:identity:read',
  directoryRead: 'account:directory:read',
})

export const ACCOUNT_HOST_METHOD_PERMISSIONS = Object.freeze({
  'identity.current': ACCOUNT_PERMISSIONS.identityRead,
  'directory.list': ACCOUNT_PERMISSIONS.directoryRead,
  'directory.search': ACCOUNT_PERMISSIONS.directoryRead,
})

export const ACCOUNT_BACKEND_EVENT_PERMISSIONS = Object.freeze({
  'directory.changed': ACCOUNT_PERMISSIONS.directoryRead,
})

export const ACCOUNT_HOST_METHODS = Object.freeze(Object.keys(ACCOUNT_HOST_METHOD_PERMISSIONS))
export const ACCOUNT_BACKEND_EVENTS = Object.freeze(Object.keys(ACCOUNT_BACKEND_EVENT_PERMISSIONS))

function requireKnownName(value, entries, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || !Object.hasOwn(entries, normalized)) {
    throw new AppServiceError(
      APP_ERROR_CODES.hostProtocol,
      `Unknown ${MOSS_ACCOUNT_PROTOCOL} ${label}: ${normalized || '<empty>'}`,
    )
  }
  return normalized
}

function record(value, label) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${label} must be an object`)
  }
  return value
}

function optionalString(input, field, method, maxLength = 512) {
  const value = input[field]
  if (value === undefined || value === null || value === '') return
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${method} has an invalid ${field}`)
  }
}

function optionalLimit(input, method) {
  if (input.limit === undefined) return
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${method} limit must be between 1 and 200`)
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

export function validateAccountHostMethod(value) {
  return requireKnownName(value, ACCOUNT_HOST_METHOD_PERMISSIONS, 'Host method')
}

export function validateAccountBackendEvent(value) {
  return requireKnownName(value, ACCOUNT_BACKEND_EVENT_PERMISSIONS, 'Backend event')
}

export function validateAccountHostInput(method, value) {
  const normalizedMethod = validateAccountHostMethod(method)
  const input = record(value, `${normalizedMethod} input`)
  for (const field of ['appId', 'instanceId', 'owner', 'principal', 'orgId', 'userId']) {
    if (Object.hasOwn(input, field)) {
      throw new AppServiceError(
        APP_ERROR_CODES.invalidInput,
        `${normalizedMethod} cannot override Runtime identity: ${field}`,
      )
    }
  }
  if (normalizedMethod === 'identity.current') {
    rejectUnknownFields(input, [], normalizedMethod)
  } else if (normalizedMethod === 'directory.list') {
    rejectUnknownFields(input, ['departmentId', 'cursor', 'limit'], normalizedMethod)
    optionalString(input, 'departmentId', normalizedMethod)
    optionalString(input, 'cursor', normalizedMethod)
    optionalLimit(input, normalizedMethod)
  } else if (normalizedMethod === 'directory.search') {
    rejectUnknownFields(input, ['query', 'departmentId', 'limit'], normalizedMethod)
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 200) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'directory.search requires a query')
    }
    optionalString(input, 'departmentId', normalizedMethod)
    optionalLimit(input, normalizedMethod)
  }
  return input
}

export function validateAccountBackendEventData(name, value) {
  const normalizedName = validateAccountBackendEvent(name)
  const data = record(value, `${normalizedName} data`)
  optionalString(data, 'revision', normalizedName, 256)
  return data
}
