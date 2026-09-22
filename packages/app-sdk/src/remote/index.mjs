import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'

export const MOSS_REMOTE_PROTOCOL = 'moss.remote/v1'

export const REMOTE_PERMISSIONS = Object.freeze({
  actions: 'remote:actions',
})

export const REMOTE_HOST_METHOD_PERMISSIONS = Object.freeze({
  'action.invoke': REMOTE_PERMISSIONS.actions,
})

export const REMOTE_HOST_METHODS = Object.freeze(Object.keys(REMOTE_HOST_METHOD_PERMISSIONS))

export function validateRemoteHostMethod(value) {
  const method = typeof value === 'string' ? value.trim() : ''
  if (!Object.hasOwn(REMOTE_HOST_METHOD_PERMISSIONS, method)) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `Unknown ${MOSS_REMOTE_PROTOCOL} Host method: ${method || '<empty>'}`)
  }
  return method
}

export function validateRemoteHostInput(method, value) {
  const normalizedMethod = validateRemoteHostMethod(method)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${normalizedMethod} input must be an object`)
  }
  const allowed = new Set(['action', 'input', 'timeoutMs', 'ownerScope'])
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${normalizedMethod} contains an unknown field: ${field}`)
  }
  if (typeof value.action !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value.action)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'action.invoke has an invalid action')
  }
  if (value.input !== undefined && (!value.input || typeof value.input !== 'object' || Array.isArray(value.input))) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'action.invoke input must be an object')
  }
  if (value.timeoutMs !== undefined
    && (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 300_000)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'action.invoke timeoutMs must be between 100 and 300000')
  }
  if (value.ownerScope !== undefined && !['user', 'org'].includes(value.ownerScope)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'action.invoke ownerScope must be user or org')
  }
  return {
    action: value.action,
    input: value.input || {},
    ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs }),
    ...(value.ownerScope === undefined ? {} : { ownerScope: value.ownerScope }),
  }
}
