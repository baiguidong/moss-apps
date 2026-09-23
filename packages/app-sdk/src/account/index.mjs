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
  'directory.user-changed': ACCOUNT_PERMISSIONS.directoryRead,
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

function requireOutputString(value, label, { nullable = false, maxLength = 512 } = {}) {
  if (nullable && value === null) return
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} is invalid`)
  }
}

function validateStringList(value, label, maxItems = 512) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} is invalid`)
  }
  for (const item of value) requireOutputString(item, label)
}

function rejectUnknownOutputFields(output, fields, label) {
  const allowed = new Set(fields)
  for (const field of Object.keys(output)) {
    if (!allowed.has(field)) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} contains an unknown field: ${field}`)
    }
  }
}

function outputRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} must be an object`)
  }
  return value
}

function validateDirectoryUser(value, label) {
  const user = outputRecord(value, label)
  rejectUnknownOutputFields(user, ['id', 'name', 'email', 'departmentId', 'status'], label)
  requireOutputString(user.id, `${label}.id`)
  requireOutputString(user.name, `${label}.name`)
  if (user.email !== undefined) requireOutputString(user.email, `${label}.email`, { nullable: true })
  if (user.departmentId !== undefined) requireOutputString(user.departmentId, `${label}.departmentId`, { nullable: true })
  if (user.status !== undefined && !['active', 'disabled'].includes(user.status)) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label}.status is invalid`)
  }
}

function validateDirectoryDepartment(value, label) {
  const department = outputRecord(value, label)
  rejectUnknownOutputFields(department, ['id', 'name', 'parentId', 'userCount'], label)
  requireOutputString(department.id, `${label}.id`)
  requireOutputString(department.name, `${label}.name`)
  if (department.parentId !== undefined) requireOutputString(department.parentId, `${label}.parentId`, { nullable: true })
  if (department.userCount !== undefined
    && (!Number.isInteger(department.userCount) || department.userCount < 0)) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label}.userCount is invalid`)
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

export function validateAccountHostOutput(method, value) {
  const normalizedMethod = validateAccountHostMethod(method)
  const output = outputRecord(value, `${normalizedMethod} output`)
  if (normalizedMethod === 'identity.current') {
    rejectUnknownOutputFields(output, ['source', 'user', 'organization', 'scopes'], 'identity.current output')
    if (!['local', 'server'].includes(output.source)) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'identity.current output source is invalid')
    }
    if (output.user !== null) validateDirectoryUser(output.user, 'identity.current output user')
    if (output.organization !== undefined && output.organization !== null) {
      const organization = outputRecord(output.organization, 'identity.current output organization')
      rejectUnknownOutputFields(organization, ['id', 'name'], 'identity.current output organization')
      requireOutputString(organization.id, 'identity.current output organization.id')
      requireOutputString(organization.name, 'identity.current output organization.name')
    }
    validateStringList(output.scopes, 'identity.current output scopes')
    return output
  }
  rejectUnknownOutputFields(output, ['users', 'departments', 'nextCursor', 'revision'], `${normalizedMethod} output`)
  if (!Array.isArray(output.users) || output.users.length > 200) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${normalizedMethod} output users is invalid`)
  }
  if (!Array.isArray(output.departments) || output.departments.length > 10_000) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${normalizedMethod} output departments is invalid`)
  }
  output.users.forEach((user, index) => validateDirectoryUser(user, `${normalizedMethod} output users[${index}]`))
  output.departments.forEach((department, index) => (
    validateDirectoryDepartment(department, `${normalizedMethod} output departments[${index}]`)
  ))
  if (output.nextCursor !== undefined) {
    requireOutputString(output.nextCursor, `${normalizedMethod} output nextCursor`, { nullable: true })
  }
  if (output.revision !== undefined) requireOutputString(output.revision, `${normalizedMethod} output revision`)
  return output
}

export function validateAccountBackendEventData(name, value) {
  const normalizedName = validateAccountBackendEvent(name)
  const data = record(value, `${normalizedName} data`)
  if (normalizedName === 'directory.changed') {
    rejectUnknownFields(data, ['revision'], normalizedName)
    optionalString(data, 'revision', normalizedName, 256)
  } else if (normalizedName === 'directory.user-changed') {
    rejectUnknownFields(data, ['user'], normalizedName)
    const user = record(data.user, `${normalizedName} user`)
    rejectUnknownFields(user, ['id', 'name', 'email', 'departmentId', 'status'], normalizedName)
    if (typeof user.id !== 'string' || !user.id.trim() || user.id.length > 512) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${normalizedName} has an invalid user id`)
    }
    if (!['active', 'disabled'].includes(user.status)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${normalizedName} has an invalid user status`)
    }
    optionalString(user, 'name', normalizedName, 512)
    optionalString(user, 'email', normalizedName, 512)
    optionalString(user, 'departmentId', normalizedName, 512)
  }
  return data
}
